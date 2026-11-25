import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { callLlmJson, hasLlmKey, withLlmRequestKey } from "@/lib/llm";
import { cacheQuiz, loadMastery } from "@/lib/mastery";
import {
  resolvePriorityContext,
  resolveSkillLabel,
} from "@/lib/session-skill";
import type { PracticeQuestion } from "@/lib/types/quiz";

type LlmQuiz = {
  questions?: Array<{
    question?: string;
    type?: string;
    options?: string[];
    correct_answer?: string;
    explanation?: string;
  }>;
};

function fallbackQuiz(
  componentId: string,
  description: string,
  grade: string,
): PracticeQuestion[] {
  return [1, 2, 3].map((n) => ({
    id: `p${n}`,
    question: `Quick check ${n} (Grade ${grade}): Show you understand — ${description}`,
    type: "short_answer" as const,
    correct_answer: "See explanation",
    target_component_id: componentId,
    explanation: `This checks: ${description}`,
  }));
}

export async function POST(request: NextRequest) {
  return withLlmRequestKey(request, async () => {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      componentId?: string;
      mode?: string;
    };

    const sessionId = String(body.sessionId ?? "").trim();
    const componentId = String(body.componentId ?? "").trim();
    if (!sessionId || !componentId) {
      return NextResponse.json(
        { error: "sessionId and componentId are required" },
        { status: 400 },
      );
    }

    const session = await loadMastery(sessionId);
    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    const description = resolveSkillLabel(session, componentId);
    const priority = resolvePriorityContext(session, componentId);
    let questions = fallbackQuiz(componentId, description, session.grade);

    if (hasLlmKey()) {
      try {
        const llm = await callLlmJson<LlmQuiz>({
          system: `You write a SHORT student-facing quick quiz for ONE math skill.
Audience: the student. Friendly wording. US grade-appropriate.
Return ONLY JSON:
{"questions":[{"question":"...","type":"multiple_choice","options":["A) ...","B) ...","C) ...","D) ..."],"correct_answer":"...","explanation":"1-2 sentences"}]}
Rules:
- Exactly 3 to 5 questions
- Prefer multiple_choice with 4 options
- correct_answer must match one option exactly
- No diagrams
- Keep numbers grade-appropriate
- This is a quick check, not a unit test`,
          user: JSON.stringify({
            grade: session.grade,
            componentId,
            skill: description,
            masteryLooksLike: priority?.masteryLooksLike ?? null,
            mode: body.mode ?? "quiz",
          }),
        });

        const parsed = (llm.questions ?? [])
          .map((q, i) => {
            const type =
              q.type === "short_answer" ? "short_answer" : "multiple_choice";
            return {
              id: `p${i + 1}`,
              question: String(q.question ?? "").trim(),
              type,
              options:
                type === "multiple_choice"
                  ? (q.options ?? []).map(String).slice(0, 4)
                  : undefined,
              correct_answer: String(q.correct_answer ?? "").trim(),
              target_component_id: componentId,
              explanation: String(q.explanation ?? "").trim(),
            } satisfies PracticeQuestion;
          })
          .filter((q) => q.question && q.correct_answer);

        if (parsed.length >= 3) questions = parsed.slice(0, 5);
      } catch (err) {
        console.error("Quiz LLM failed, using fallback", err);
      }
    }

    await cacheQuiz(sessionId, componentId, { description, questions });
    return NextResponse.json({
      sessionId,
      componentId,
      description,
      mode: "quiz",
      questions,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
});
}
