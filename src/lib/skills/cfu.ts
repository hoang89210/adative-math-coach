import { callLlmJson, hasLlmKey } from "@/lib/llm";
import { logError } from "@/lib/log-safe";

import type { CfuCheck, CfuItem, CfuRigor } from "@/lib/types/skills";

type LlmCfu = {
  focus?: string;
  rigor?: string;
  items?: Array<{
    id?: string;
    stem?: string;
    type?: string;
    options?: string[];
    correct_answer?: string;
    responseRoutes?: Array<{
      choice?: string;
      reveals?: string;
      nextStep?: string;
    }>;
  }>;
};

function normalizeRigor(value: string | undefined): CfuRigor {
  const v = (value ?? "").toLowerCase();
  if (v === "procedural" || v === "application" || v === "mixed") return v;
  return "conceptual";
}

function fallbackCfu(componentId: string, skill: string, grade: string): CfuCheck {
  const optCorrect = "A) Uses the idea correctly";
  const optPrereq = "B) Mixes up an earlier idea needed for this skill";
  const optOnGrade = "C) Uses an on-grade shortcut that does not always work";
  const optOther = "D) Guesses without connecting to the key idea";

  const item: CfuItem = {
    id: "cfu1",
    stem: `Grade ${grade}: Which choice best shows solid thinking about “${skill}”?`,
    type: "multiple_choice",
    options: [optCorrect, optPrereq, optOnGrade, optOther],
    correct_answer: optCorrect,
    responseRoutes: [
      {
        choice: optCorrect,
        reveals: "You connected the key idea to a clear decision.",
        nextStep: "Try one similar problem and explain your steps out loud.",
      },
      {
        choice: optPrereq,
        reveals: "An earlier building-block idea may still be settling.",
        nextStep:
          "Revisit the prerequisite idea with a worked example, then return to this skill.",
      },
      {
        choice: optOnGrade,
        reveals: "A common on-grade mix-up showed up in the method.",
        nextStep:
          "Compare two methods side by side and name when each one works.",
      },
      {
        choice: optOther,
        reveals: "The choice did not show a clear mathematical reason yet.",
        nextStep: "Start from the key idea sentence, then re-answer slowly.",
      },
    ],
  };

  return {
    componentId,
    focus: skill,
    rigor: "conceptual",
    items: [item],
  };
}

export async function generateCfuCheck(params: {
  componentId: string;
  skill: string;
  grade: string;
  masteryLooksLike?: string | null;
  misconceptionHints?: string[];
}): Promise<CfuCheck> {
  const base = fallbackCfu(params.componentId, params.skill, params.grade);
  if (!hasLlmKey()) return base;

  try {
    const llm = await callLlmJson<LlmCfu>({
      system: `You create a Math Check for Understanding (CFU) for ONE learning component.
Pedagogy adapted from Learning Commons k12-check-for-understanding (math):
- 1 to 3 items only (prefer 2)
- Formative: reveal thinking, not a long scored quiz
- Prefer multiple_choice; every distractor maps to a named reasoning pattern
- At least one route = prerequisite gap; one = on-grade confusion
- Student language at grade band (grade 3-5 ~12 words/sentence)
- Asset-based wording: never "weak/behind/failing/can't"
- responseRoutes required for EVERY option including correct
Return ONLY JSON:
{
  "focus":"plain skill focus",
  "rigor":"conceptual|procedural|application|mixed",
  "items":[{
    "id":"cfu1",
    "stem":"...",
    "type":"multiple_choice",
    "options":["A) ...","B) ...","C) ...","D) ..."],
    "correct_answer":"must match one option exactly",
    "responseRoutes":[{"choice":"...","reveals":"...","nextStep":"..."}]
  }]
}`,
      user: JSON.stringify({
        grade: params.grade,
        componentId: params.componentId,
        skill: params.skill,
        masteryLooksLike: params.masteryLooksLike ?? null,
        misconceptionHints: params.misconceptionHints ?? [],
      }),
    });

    const items: CfuItem[] = (llm.items ?? [])
      .map((it, i) => {
        const type =
          it.type === "short_answer" ? "short_answer" : "multiple_choice";
        const options =
          type === "multiple_choice"
            ? (it.options ?? []).map(String).slice(0, 4)
            : undefined;
        const routes = (it.responseRoutes ?? [])
          .map((r) => ({
            choice: String(r.choice ?? "").trim(),
            reveals: String(r.reveals ?? "").trim(),
            nextStep: String(r.nextStep ?? "").trim(),
          }))
          .filter((r) => r.choice && r.reveals && r.nextStep);

        return {
          id: String(it.id ?? `cfu${i + 1}`),
          stem: String(it.stem ?? "").trim(),
          type,
          options,
          correct_answer: String(it.correct_answer ?? "").trim(),
          responseRoutes: routes,
        } satisfies CfuItem;
      })
      .filter(
        (it) =>
          it.stem &&
          it.correct_answer &&
          it.responseRoutes.length >= 2 &&
          (it.type !== "multiple_choice" || (it.options?.length ?? 0) >= 3),
      );

    if (items.length >= 1) {
      return {
        componentId: params.componentId,
        focus: String(llm.focus ?? params.skill),
        rigor: normalizeRigor(llm.rigor),
        items: items.slice(0, 3),
      };
    }
  } catch (err) {
    logError("CFU LLM failed", err);
  }

  return base;
}

export function matchCfuRoute(
  item: CfuItem,
  answer: string,
): { isCorrect: boolean; route: CfuItem["responseRoutes"][0] | null } {
  const a = answer.trim().toLowerCase().replace(/\s+/g, " ");
  const correct = item.correct_answer.trim().toLowerCase().replace(/\s+/g, " ");
  const isCorrect =
    a === correct ||
    (/^[a-d]$/.test(a) && correct.startsWith(`${a})`)) ||
    item.options?.some(
      (opt) =>
        opt.trim().toLowerCase() === a &&
        opt.trim().toLowerCase() === correct,
    ) === true;

  const route =
    item.responseRoutes.find((r) => {
      const c = r.choice.trim().toLowerCase().replace(/\s+/g, " ");
      return c === a || a === c || (a.length === 1 && c.startsWith(`${a})`));
    }) ??
    (isCorrect
      ? item.responseRoutes.find(
          (r) =>
            r.choice.trim().toLowerCase().replace(/\s+/g, " ") === correct,
        ) ?? null
      : null);

  return { isCorrect, route: route ?? null };
}
