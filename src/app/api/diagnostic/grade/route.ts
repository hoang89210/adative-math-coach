import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { computeCoverage } from "@/lib/analytics/coverage";
import { getComponentsByIds } from "@/lib/data/learning-components";
import { logEvent } from "@/lib/events";
import { mergeDiagnosticIntoLearner } from "@/lib/learners";
import { saveMastery } from "@/lib/mastery";
import type {
  AnswerSubmission,
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
    const body = (await request.json()) as {
      grade?: string;
      jurisdiction?: string;
      learnerId?: string;
      questions?: DiagnosticQuestion[];
      answers?: AnswerSubmission[];
      components?: Array<{ id: string; description: string }>;
    };

    const grade = String(body.grade ?? "").trim();
    const jurisdiction = body.jurisdiction
      ? String(body.jurisdiction).trim()
      : undefined;
    const learnerId = body.learnerId ? String(body.learnerId).trim() : undefined;
    const questions = body.questions ?? [];
    const answers = body.answers ?? [];
    const components = body.components ?? [];

    if (!grade || questions.length === 0) {
      return NextResponse.json(
        { error: "grade and questions are required" },
        { status: 400 },
      );
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
    let score = 0;

    for (const q of questions) {
      const userAnswer = answerMap.get(q.id) ?? "";
      const ok = isCorrect(q, userAnswer);
      if (ok) score += 1;
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
      const message = err instanceof Error ? err.message : String(err);
      await logEvent({
        kind: "diagnostic_grade",
        grade,
        learnerId,
        ok: false,
        message,
      });
      return NextResponse.json({ error: message }, { status: 500 });
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
        console.error("learner merge failed", err);
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

    return NextResponse.json({ sessionId, result, coverage });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logEvent({ kind: "diagnostic_grade", ok: false, message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
