import { HttpError } from "@/lib/api-errors";
import type {
  AnswerSubmission,
  DiagnosticQuestion,
} from "@/lib/types/quiz";

/**
 * Input validation for POST /api/diagnostic/grade (pure, unit-tested).
 * Diagnostics are generated with <= 8 questions, so these caps leave
 * headroom while stopping abuse of the LC-evidence write path.
 */
export const GRADE_MAX_BODY_BYTES = 128 * 1024;
export const GRADE_MAX_QUESTIONS = 30;
export const GRADE_MAX_ANSWERS = 60;
export const GRADE_MAX_COMPONENTS = 30;
/** Max LC ids per item (target_component_id + target_component_ids). */
export const GRADE_MAX_LCS_PER_ITEM = 4;
/** Max distinct LCs one graded attempt may write evidence for. */
export const GRADE_MAX_DISTINCT_LCS = 16;
const MAX_ID_LEN = 80;
const MAX_TEXT_LEN = 4_000;
const MAX_ANSWER_LEN = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GradeInput = {
  grade: string;
  jurisdiction?: string;
  learnerId?: string;
  /** ownership proof issued by /api/learners (never logged) */
  learnerToken?: string;
  questions: DiagnosticQuestion[];
  answers: AnswerSubmission[];
  components: Array<{ id: string; description: string }>;
};

function str(v: unknown, max: number): string {
  return typeof v === "string" || typeof v === "number"
    ? String(v).slice(0, max)
    : "";
}

export function validateGradeBody(body: Record<string, unknown>): GradeInput {
  const grade = str(body.grade, 4).trim();
  if (!/^(K|\d{1,2})$/i.test(grade)) {
    throw new HttpError(400, "grade and questions are required");
  }
  const rawQs = body.questions;
  if (!Array.isArray(rawQs) || rawQs.length === 0) {
    throw new HttpError(400, "grade and questions are required");
  }
  if (rawQs.length > GRADE_MAX_QUESTIONS) {
    throw new HttpError(400, `Too many questions (max ${GRADE_MAX_QUESTIONS})`);
  }
  const rawAnswers = body.answers ?? [];
  if (!Array.isArray(rawAnswers) || rawAnswers.length > GRADE_MAX_ANSWERS) {
    throw new HttpError(400, `Too many answers (max ${GRADE_MAX_ANSWERS})`);
  }
  const rawComponents = body.components ?? [];
  if (!Array.isArray(rawComponents) || rawComponents.length > GRADE_MAX_COMPONENTS) {
    throw new HttpError(400, `Too many components (max ${GRADE_MAX_COMPONENTS})`);
  }

  let learnerId: string | undefined;
  if (body.learnerId !== undefined && body.learnerId !== null && body.learnerId !== "") {
    const id = str(body.learnerId, 64).trim();
    if (!UUID_RE.test(id)) throw new HttpError(400, "invalid learnerId");
    learnerId = id;
  }
  let learnerToken: string | undefined;
  if (typeof body.learnerToken === "string" && body.learnerToken) {
    learnerToken = body.learnerToken.slice(0, 200);
  }

  const questions: DiagnosticQuestion[] = rawQs.map((raw, i) => {
    const q = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const target = str(q.target_component_id, MAX_ID_LEN).trim();
    if (!target) throw new HttpError(400, `question ${i + 1}: target_component_id is required`);
    let extra: string[] | undefined;
    if (q.target_component_ids !== undefined) {
      if (!Array.isArray(q.target_component_ids)) {
        throw new HttpError(400, `question ${i + 1}: target_component_ids must be an array`);
      }
      extra = [...new Set(q.target_component_ids.map((x) => str(x, MAX_ID_LEN).trim()).filter(Boolean))].filter(
        (x) => x !== target,
      );
      if (extra.length + 1 > GRADE_MAX_LCS_PER_ITEM) {
        throw new HttpError(
          400,
          `question ${i + 1}: too many learning components (max ${GRADE_MAX_LCS_PER_ITEM})`,
        );
      }
    }
    const options = Array.isArray(q.options)
      ? q.options.slice(0, 8).map((o) => str(o, 1_000))
      : undefined;
    return {
      id: str(q.id, MAX_ID_LEN) || `q${i}`,
      question: str(q.question, MAX_TEXT_LEN),
      type: q.type === "multiple_choice" ? "multiple_choice" : "short_answer",
      options,
      correct_answer: str(q.correct_answer, 1_000),
      target_component_id: target,
      target_component_ids: extra,
      explanation: str(q.explanation, MAX_TEXT_LEN),
    };
  });

  const answers: AnswerSubmission[] = rawAnswers.map((raw) => {
    const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return { questionId: str(a.questionId, MAX_ID_LEN), answer: str(a.answer, MAX_ANSWER_LEN) };
  });
  const components = rawComponents.map((raw) => {
    const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return { id: str(c.id, MAX_ID_LEN), description: str(c.description, 1_000) };
  });
  const jurisdiction = str(body.jurisdiction, 60).trim() || undefined;
  return { grade: grade.toUpperCase() === "K" ? "K" : grade, jurisdiction, learnerId, learnerToken, questions, answers, components };
}

/**
 * Keep only LC ids that exist in the LC index, and at most
 * GRADE_MAX_DISTINCT_LCS distinct LCs per attempt (first seen wins).
 */
export function filterEvidenceLcIds(
  observations: Array<{ lcIds: string[]; correct: boolean }>,
  isKnownLc: (id: string) => boolean,
): { observations: Array<{ lcIds: string[]; correct: boolean }>; dropped: number } {
  const allowed = new Set<string>();
  let dropped = 0;
  const out = observations.map((o) => {
    const ids: string[] = [];
    for (const id of o.lcIds) {
      if (!isKnownLc(id)) {
        dropped += 1;
        continue;
      }
      if (!allowed.has(id)) {
        if (allowed.size >= GRADE_MAX_DISTINCT_LCS) {
          dropped += 1;
          continue;
        }
        allowed.add(id);
      }
      ids.push(id);
    }
    return { lcIds: ids, correct: o.correct };
  });
  return { observations: out.filter((o) => o.lcIds.length > 0), dropped };
}
