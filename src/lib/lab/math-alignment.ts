import { callLlmJson, hasLlmKey } from "@/lib/llm";
import type { MathAlignmentResult } from "./types";

type LlmOut = {
  summary?: string;
  learning_components?: Array<{
    identifier?: string;
    description?: string;
    reasoning?: string;
    aligned?: boolean;
    feedback?: string | null;
  }>;
};

export async function evaluateMathAlignmentLab(params: {
  question: string;
  statement_code: string;
  jurisdiction?: string;
  learningComponentHints?: Array<{ id: string; description: string }>;
}): Promise<MathAlignmentResult> {
  const jurisdiction = params.jurisdiction?.trim() || "Multi-State";
  const code = params.statement_code.trim();
  const question = params.question.trim();

  if (!question || !code) {
    throw new Error("question and statement_code are required");
  }

  if (!hasLlmKey()) {
    return {
      evaluator: "math-standards-alignment",
      mode: "lab-openai",
      question,
      statement_code: code,
      jurisdiction,
      case_identifier_uuid: null,
      learning_components: [],
      aligned_count: 0,
      total_count: 0,
      summary:
        "OPENAI_API_KEY missing — cannot run Quality Lab math alignment. Add a key to evaluate.",
    };
  }

  const llm = await callLlmJson<LlmOut>({
    system: `You are an expert in K-12 math academic standards (Quality Lab / academic QA role).
Evaluate whether an assessment question aligns to a math standard by checking against learning components.
Inspired by Learning Commons Math Standards Alignment evaluator.
Return ONLY JSON:
{
  "summary": "1-3 sentences overall",
  "learning_components": [{
    "identifier": "lc-id or lc-1",
    "description": "skill the LC names",
    "reasoning": "what LC requires vs what question elicits",
    "aligned": true/false,
    "feedback": "if not aligned: concrete revision; if aligned: brief note or null"
  }]
}
Rules:
- Use provided learning component hints when present; otherwise infer 3-6 plausible LCs for the standard code
- aligned=true only if the question directly elicits that LC skill
- Be specific about numbers, representations, and cognitive demand
- No publisher names`,
    user: JSON.stringify({
      question,
      statement_code: code,
      jurisdiction,
      learning_component_hints: params.learningComponentHints ?? [],
    }),
    temperature: 0.2,
  });

  const lcs = (llm.learning_components ?? [])
    .map((c, i) => ({
      identifier: String(c.identifier ?? `lc-${i + 1}`),
      description: String(c.description ?? "").trim(),
      reasoning: String(c.reasoning ?? "").trim(),
      aligned: Boolean(c.aligned),
      feedback:
        c.feedback === null || c.feedback === undefined
          ? null
          : String(c.feedback),
    }))
    .filter((c) => c.description && c.reasoning);

  const aligned_count = lcs.filter((c) => c.aligned).length;

  return {
    evaluator: "math-standards-alignment",
    mode: "lab-openai",
    question,
    statement_code: code,
    jurisdiction,
    case_identifier_uuid: null,
    learning_components: lcs,
    aligned_count,
    total_count: lcs.length,
    summary: String(
      llm.summary ??
        `${aligned_count}/${lcs.length} learning components appear aligned.`,
    ),
  };
}
