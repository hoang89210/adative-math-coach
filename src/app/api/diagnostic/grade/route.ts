import { NextRequest, NextResponse } from "next/server";
import { HttpError, errorResponse, readJsonBody } from "@/lib/api-errors";
import { randomUUID } from "crypto";
import { computeCoverage } from "@/lib/analytics/coverage";
import {
  getComponentsByIds,
  getStandardIndex,
} from "@/lib/data/learning-components";
import { logEvent } from "@/lib/events";
import {
  GRADE_MAX_BODY_BYTES,
  filterEvidenceLcIds,
  validateGradeBody,
} from "@/lib/grade-input";
import { logError } from "@/lib/log-safe";
import { sanitizeDbError } from "@/lib/sanitize-error";

import { loadLearnerById, mergeDiagnosticIntoLearner } from "@/lib/learners";
import { deltasFromObservations, type ItemObservation } from "@/lib/lc-mastery";
import { recordLcEvidence } from "@/lib/lc-mastery-store";
import { saveMastery } from "@/lib/mastery";
import type {
  ComponentResult,
  DiagnosticQuestion,
  GradeResult,
} from "@/lib/types/quiz";

export const maxDuration = 60;

function normalizeAnswer(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isCorrect(question: DiagnosticQuestion, answer: string) {
  const a = normalizeAnswer(answer);
  const correct = normalizeAnswer(question.correct_answer);
  if (!a) return false;
  if (a === correct) return true;
  if (question.options?.length) {
    const idx = question.options.findIndex(
      (opt) => normalizeAnswer(opt) === correct,
    );
    if (idx >= 0) {
      const letter = String.fromCharCode(65 + idx).toLowerCase();
      if (a === letter || a === `${letter}.` || a === correct) return true;
    }
    const ansIdx = question.options.findIndex(
      (opt) => normalizeAnswer(opt) === a,
    );
    if (ansIdx >= 0 && normalizeAnswer(question.options[ansIdx]) === correct) {
      return true;
    }
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const input = validateGradeBody(
      await readJsonBody(request, GRADE_MAX_BODY_BYTES),
    );
    const { grade, jurisdiction, learnerId, questions, answers, components } =
      input;

    // Learner binding: the learner must exist before we write anything for
    // it. A DB timeout here propagates -> 503 + Retry-After.
    if (learnerId) {
      const learner = await loadLearnerById(learnerId);
      if (!learner) {
        return NextResponse.json({ error: "learner not found" }, { status: 404 });
      }
    }

    const answerMap = new Map(answers.map((a) => [a.questionId, a.answer]));
    const componentMeta = new Map(
      components.map((c) => [c.id, c.description]),
    );
    for (const q of questions) {
      if (!componentMeta.has(q.target_component_id)) {
        componentMeta.set(q.target_component_id, q.target_component_id);
      }
    }

    const tallies = new Map<string, { correct: number; total: number }>();
    const observations: ItemObservation[] = [];
    let score = 0;

    for (const q of questions) {
      const userAnswer = answerMap.get(q.id) ?? "";
      const ok = isCorrect(q, userAnswer);
      if (ok) score += 1;
      const extraIds = q.target_component_ids ?? [];
      observations.push({
        lcIds: [q.target_component_id, ...extraIds].filter(Boolean),
        correct: ok,
      });
      const t = tallies.get(q.target_component_id) ?? {
        correct: 0,
        total: 0,
      };
      t.total += 1;
      if (ok) t.correct += 1;
      tallies.set(q.target_component_id, t);
    }

    const byComponent: ComponentResult[] = [...tallies.entries()].map(
      ([componentId, t]) => ({
        componentId,
        description: componentMeta.get(componentId) ?? componentId,
        correct: t.correct,
        total: t.total,
        mastered: t.total > 0 && t.correct === t.total,
      }),
    );

    const weakComponents = byComponent.filter((c) => !c.mastered);
    const strongComponents = byComponent.filter((c) => c.mastered);

    const result: GradeResult = {
      grade,
      score,
      total: questions.length,
      percent: Math.round((score / questions.length) * 100),
      byComponent,
      weakComponents,
      strongComponents,
    };

    const meta = await getComponentsByIds(
      grade,
      byComponent.map((c) => c.componentId),
    );
    const coverage = computeCoverage({
      grade,
      jurisdiction,
      result,
      componentsMeta: meta,
    });

    const sessionId = randomUUID();
    try {
      await saveMastery({
        id: sessionId,
        createdAt: new Date().toISOString(),
        grade,
        jurisdiction,
        learnerId,
        result,
        coverage,
      });
    } catch (err) {
      // DB down / hanging: 503 + Retry-After (consistent with learner
      // create/login). Nothing was persisted, so the client should retry.
      await logEvent({
        kind: "diagnostic_grade",
        grade,
        learnerId,
        ok: false,
        message: sanitizeDbError(err),
      });
      return errorResponse(err);
    }

    // LC Beta posteriors (our own statistics; Postgres with in-memory fallback)
    let lcMasteryStore: "db" | "memory" | "skipped" = "skipped";
    let lcIdsDropped = 0;
    if (learnerId) {
      try {
        const known = getStandardIndex().components;
        const filtered = filterEvidenceLcIds(observations, (id) => known.has(id));
        lcIdsDropped = filtered.dropped;
        lcMasteryStore = await recordLcEvidence(
          learnerId,
          deltasFromObservations(filtered.observations),
        );
      } catch (err) {
        logError("lc mastery update failed", err);
      }
    }

    if (learnerId) {
      try {
        await mergeDiagnosticIntoLearner({
          learnerId,
          sessionId,
          grade,
          result,
          coverage,
        });
      } catch (err) {
        logError("learner merge failed", err);
      }
    }

    await logEvent({
      kind: "diagnostic_grade",
      sessionId,
      learnerId,
      grade,
      ok: true,
      meta: { percent: result.percent, total: result.total },
    });

    return NextResponse.json({
      sessionId,
      result,
      coverage,
      lcMasteryStore,
      lcIdsDropped,
    });
  } catch (err) {
    if (!(err instanceof HttpError)) {
      await logEvent({
        kind: "diagnostic_grade",
        ok: false,
        message: sanitizeDbError(err),
      });
    }
    return errorResponse(err);
  }
}
