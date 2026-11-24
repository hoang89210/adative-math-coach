import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import {
  getLearningComponentsByGrade,
  pickComponentsForDiagnostic,
} from "@/lib/data/learning-components";
import { callLlmJson, hasLlmKey } from "@/lib/llm";
import type { DiagnosticQuestion, DiagnosticTest } from "@/lib/types/quiz";

type GrokDiagnosticResponse = {
  questions?: Array<{
    question?: string;
    type?: string;
    options?: string[];
    correct_answer?: string;
    target_component_id?: string;
    explanation?: string;
  }>;
};

function fallbackQuestions(
  grade: string,
  components: Array<{ id: string; description: string }>,
): DiagnosticQuestion[] {
  return components.map((c, i) => ({
    id: `q${i + 1}`,
    question: `Grade ${grade}: Show understanding of — ${c.description}`,
    type: "short_answer" as const,
    correct_answer: "See explanation",
    target_component_id: c.id,
    explanation: `This item targets: ${c.description}`,
  }));
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { grade?: string };
    const grade = String(body.grade ?? "").trim();
    if (!grade) {
      return NextResponse.json({ error: "grade is required" }, { status: 400 });
    }

    const all = await getLearningComponentsByGrade(grade);
    if (all.length < 5) {
      return NextResponse.json(
        {
          error: `Not enough learning components for grade ${grade} (found ${all.length})`,
        },
        { status: 404 },
      );
    }

    const selected = pickComponentsForDiagnostic(all, 7);
    const componentPayload = selected.map((c) => ({
      id: c.id,
      description: c.description,
      standards: c.relatedStandards
        .slice(0, 2)
        .map((s) => s.code || s.description)
        .filter(Boolean),
    }));

    let questions: DiagnosticQuestion[] = [];

    if (hasLlmKey()) {
      try {
        const grok = await callLlmJson<GrokDiagnosticResponse>({
          system: `You are an expert elementary/middle school math assessment writer for US Common Core style skills.
Return ONLY valid JSON with shape:
{"questions":[{"question":"...","type":"multiple_choice"|"short_answer","options":["A","B","C","D"],"correct_answer":"...","target_component_id":"...","explanation":"..."}]}
Rules:
- Exactly one question per provided learning component
- Grade-appropriate language and numbers
- multiple_choice preferred; include 4 options when type is multiple_choice
- correct_answer must match one option for multiple_choice
- target_component_id MUST be exactly one of the provided component ids
- Keep questions concise and solvable without diagrams`,
          user: JSON.stringify({
            grade,
            learning_components: componentPayload,
          }),
        });

        questions = (grok.questions ?? [])
          .map((q, i) => {
            const target =
              q.target_component_id &&
              selected.some((c) => c.id === q.target_component_id)
                ? q.target_component_id
                : selected[i % selected.length].id;
            const type =
              q.type === "short_answer" ? "short_answer" : "multiple_choice";
            return {
              id: `q${i + 1}`,
              question: String(q.question ?? "").trim(),
              type,
              options:
                type === "multiple_choice"
                  ? (q.options ?? []).map(String).slice(0, 4)
                  : undefined,
              correct_answer: String(q.correct_answer ?? "").trim(),
              target_component_id: target,
              explanation: String(q.explanation ?? "").trim(),
            } satisfies DiagnosticQuestion;
          })
          .filter((q) => q.question && q.correct_answer);
      } catch (err) {
        console.error("Grok diagnostic failed, using fallback", err);
        questions = fallbackQuestions(
          grade,
          selected.map((c) => ({ id: c.id, description: c.description })),
        );
      }
    } else {
      questions = fallbackQuestions(
        grade,
        selected.map((c) => ({ id: c.id, description: c.description })),
      );
    }

    if (questions.length < 6) {
      questions = fallbackQuestions(
        grade,
        selected.map((c) => ({ id: c.id, description: c.description })),
      );
    }

    const test: DiagnosticTest = {
      grade,
      questions: questions.slice(0, 8),
      components: selected.map((c) => ({
        id: c.id,
        description: c.description,
      })),
    };

    return NextResponse.json(test);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
