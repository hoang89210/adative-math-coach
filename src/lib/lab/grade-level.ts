import { callLlmJson, hasLlmKey } from "@/lib/llm";
import type { GradeLevelResult } from "./types";

type LlmOut = {
  reasoning?: string;
  grade_band?: string;
  alternative_grade_band?: string;
  scaffolding_needed?: string;
  fit_note?: string;
};

const BANDS = ["K-1", "2-3", "4-5", "6-8", "9-10", "11-12"] as const;
type Band = (typeof BANDS)[number];

function asBand(v: string | undefined, fallback: Band): Band {
  if (v && (BANDS as readonly string[]).includes(v)) return v as Band;
  return fallback;
}

function bandForGrade(grade: string | undefined): Band {
  const g = (grade ?? "").toUpperCase();
  if (g === "K" || g === "1") return "K-1";
  if (g === "2" || g === "3") return "2-3";
  if (g === "4" || g === "5") return "4-5";
  if (g === "6" || g === "7" || g === "8") return "6-8";
  if (g === "9" || g === "10") return "9-10";
  return "11-12";
}

export async function evaluateGradeLevelLab(params: {
  text: string;
  target_grade?: string;
}): Promise<GradeLevelResult> {
  const text = params.text.trim();
  if (!text) throw new Error("text is required");

  const expected = bandForGrade(params.target_grade);

  if (!hasLlmKey()) {
    return {
      evaluator: "grade-level-appropriateness",
      mode: "lab-openai",
      text,
      target_grade: params.target_grade,
      reasoning: "OPENAI_API_KEY missing — cannot run grade-level evaluation.",
      grade_band: expected,
      alternative_grade_band: expected,
      scaffolding_needed: "Add API key to evaluate.",
      fit_note: "Not evaluated.",
    };
  }

  const llm = await callLlmJson<LlmOut>({
    system: `You evaluate grade-level appropriateness of student-facing text (Quality Lab / academic QA).
Inspired by Learning Commons Grade Level Appropriateness evaluator.
Return ONLY JSON:
{
  "reasoning": "numbered bullets: quantitative, qualitative, background knowledge, synthesis",
  "grade_band": "K-1|2-3|4-5|6-8|9-10|11-12",
  "alternative_grade_band": "same enum",
  "scaffolding_needed": "what makes alternative band work",
  "fit_note": "if target_grade provided, say if text fits that grade's students"
}
grade_band = independent reading/listening access band for the text.`,
    user: JSON.stringify({
      text,
      target_grade: params.target_grade ?? null,
    }),
    temperature: 0.2,
  });

  const grade_band = asBand(llm.grade_band, expected);
  const alternative_grade_band = asBand(
    llm.alternative_grade_band,
    grade_band,
  );

  return {
    evaluator: "grade-level-appropriateness",
    mode: "lab-openai",
    text,
    target_grade: params.target_grade,
    reasoning: String(llm.reasoning ?? ""),
    grade_band,
    alternative_grade_band,
    scaffolding_needed: String(llm.scaffolding_needed ?? ""),
    fit_note: String(llm.fit_note ?? ""),
  };
}
