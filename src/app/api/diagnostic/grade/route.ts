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
import { isDbTimeoutError } from "@/lib/db/client";
import { logError } from "@/lib/log-safe";
import { sanitizeDbError } from "@/lib/sanitize-error";

import { loadLearnerById, mergeDiagnosticIntoLearner } from "@/lib/learners";
import { deltasFromObservations, type ItemObservation } from "@/lib/lc-mastery";
import { recordLcEvidence } from "@/lib/lc-mastery-store";
import { saveMastery } from "@/lib/mastery";
import { verifyLearnerToken } from "@/lib/learner-token";
import { consumeRequestRateLimit, getClientIp } from "@/lib/pin-rate-limit";
import type {
  ComponentResult,
  DiagnosticQuestion,
  GradeResult,
} from "@/lib/types/quiz";

export const maxDuration = 60;

/** Evidence-write throttles per 15-minute window (shared amc_rate_limits). */
export const GRADE_RATE_LIMIT_PER_IP = 60;
export const GRADE_RATE_LIMIT_PER_LEARNER = 30;

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
    const { grade, jurisdiction, questions, answers, components } = input;

    // Ownership: only link / write evidence for a learner when the caller
    // proves it created the learner or knows its PIN (signed token from
    // /api/learners). Without it we still grade, but nothing is written to
    // that learner (learnerLinked:false) and the UI asks to sign in again.
    let learnerId: string | undefined;
    let learnerLinkIssue: string | undefined;
    if (input.learnerId) {
      const check = verifyLearnerToken(input.learnerId, input.learnerToken);
      if (check.ok) learnerId = input.learnerId;
      else learnerLinkIssue = check.reason;
    }

    // Rate limit (same infra as PIN login): per IP always, per learner when linked.
    const ip = getClientIp(request);
    const limit = await consumeRequestRateLimit([
      { key: `grade:ip:${ip}`, max: GRADE_RATE_LIMIT_PER_IP },
      ...(learnerId
        ? [{ key: `grade:learner:${learnerId.toLowerCase()}`, max: GRADE_RATE_LIMIT_PER_LEARNER }]
        : []),
    ]);
    if (limit.limited) {
      return NextResponse.json(
        { error: "Too many submissions. Please wait and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }

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

    // LC Beta posteriors (our own statistics). Memory fallback only when
    // no DB is configured; a configured-but-down DB throws and becomes
    // 503 + Retry-After (same as session save). The common outage path
    // already 503s earlier (saveMastery / loadLearnerById); this covers
    // the rarer case where the session wrote but amc_lc_mastery did not.
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
        if (isDbTimeoutError(err)) return errorResponse(err);
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
      learnerLinked: Boolean(learnerId),
      ...(learnerLinkIssue ? { learnerLinkIssue } : {}),
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
