import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { randomUUID } from "crypto";
import { saveMastery } from "@/lib/mastery";
import type {
  AnswerSubmission,
  ComponentResult,
  DiagnosticQuestion,
  GradeResult,
} from "@/lib/types/quiz";

function normalizeAnswer(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isCorrect(question: DiagnosticQuestion, answer: string) {
  const a = normalizeAnswer(answer);
  const correct = normalizeAnswer(question.correct_answer);
  if (!a) return false;
  if (a === correct) return true;
  // allow matching option letter like "A" vs full text
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
      questions?: DiagnosticQuestion[];
      answers?: AnswerSubmission[];
      components?: Array<{ id: string; description: string }>;
    };

    const grade = String(body.grade ?? "").trim();
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

    const sessionId = randomUUID();
    await saveMastery({
      id: sessionId,
      createdAt: new Date().toISOString(),
      grade,
      result,
    });

    return NextResponse.json({ sessionId, result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
