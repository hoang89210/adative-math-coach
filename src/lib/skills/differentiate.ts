import { callLlmJson, hasLlmKey } from "@/lib/llm";
import { logError } from "@/lib/log-safe";

import type { StudySheet } from "@/lib/types/quiz";
import type {
  DiffGroup,
  DiffTier,
  DifferentiationPackage,
} from "@/lib/types/skills";

type LlmDiff = {
  teacherPlanLite?: {
    standardGist?: string;
    flexibleGroupingNote?: string;
    whyThisWorks?: string[];
  };
  tiers?: Array<{
    group?: string;
    level?: string;
    title?: string;
    intro?: string;
    tasks?: Array<{ id?: string; prompt?: string; supportNote?: string }>;
    exitCheck?: string;
    ifYouFinishEarly?: string;
  }>;
};

function fallbackDiff(
  componentId: string,
  skill: string,
  sheet: StudySheet,
): DifferentiationPackage {
  const baseTask = sheet.workedExample.problem;
  return {
    componentId,
    sourceSheetTitle: sheet.title,
    teacherPlanLite: {
      standardGist: skill,
      flexibleGroupingNote:
        "Groups are flexible. Move students when formative evidence from this work suggests a better fit.",
      whyThisWorks: [
        "Group A uses a scaffolded path up to the same grade-level idea.",
        "Group C extends the same idea with less structure, not a different standard.",
      ],
    },
    tiers: [
      {
        group: "A",
        level: "below",
        title: "Group A",
        intro: `We will reach “${skill}” with extra supports.`,
        tasks: [
          {
            id: "a1",
            prompt: `Look at this example first: ${sheet.workedExample.solution.slice(0, 160)}`,
            supportNote: "Sentence starter: First I notice… Then I…",
          },
          {
            id: "a2",
            prompt: `Now try a close version of: ${baseTask}`,
            supportNote: "Use the key idea: " + sheet.keyIdea.slice(0, 120),
          },
        ],
        exitCheck: "In one sentence, what is the key idea?",
        ifYouFinishEarly: "Explain the example to a partner using your own words.",
      },
      {
        group: "B",
        level: "at",
        title: "Group B",
        intro: `Practice “${skill}” at grade level.`,
        tasks: [
          {
            id: "b1",
            prompt: baseTask,
          },
          {
            id: "b2",
            prompt: `Create and solve one new problem about: ${skill}`,
          },
        ],
        exitCheck: "How do you know your answer makes sense?",
        ifYouFinishEarly: "Write one common mix-up and how to avoid it.",
      },
      {
        group: "C",
        level: "above",
        title: "Group C",
        intro: `Stretch “${skill}” with multi-step thinking.`,
        tasks: [
          {
            id: "c1",
            prompt: `Solve a multi-step version related to: ${skill}`,
          },
          {
            id: "c2",
            prompt:
              "Compare two methods. Which is more efficient here, and why?",
          },
        ],
        exitCheck: "What would change if one condition in the problem changed?",
        ifYouFinishEarly: "Write a challenge problem for a classmate.",
      },
    ],
  };
}

function asGroup(v: string | undefined, fallback: DiffGroup): DiffGroup {
  if (v === "A" || v === "B" || v === "C") return v;
  return fallback;
}

function asLevel(
  v: string | undefined,
  fallback: DiffTier["level"],
): DiffTier["level"] {
  if (v === "below" || v === "at" || v === "above") return v;
  return fallback;
}

export async function generateDifferentiation(params: {
  componentId: string;
  skill: string;
  grade: string;
  sheet: StudySheet;
}): Promise<DifferentiationPackage> {
  const base = fallbackDiff(params.componentId, params.skill, params.sheet);
  if (!hasLlmKey()) return base;

  try {
    const llm = await callLlmJson<LlmDiff>({
      system: `You differentiate ONE math study sheet into leveled student practice.
Pedagogy adapted from Learning Commons k12-lesson-differentiation (math):
- Output 1 teacherPlanLite + exactly 3 student tiers Group A/B/C
- A=below (scaffolds UP to grade-level), B=at, C=above extension
- Same skill/standard scope on ALL tiers — do not drop cognitive demand for A
- Same engaging context across tiers when possible; change supports, not the goal
- Student-facing text: no words "tier", "scaffold", "misconception", "below grade", "differentiation"
- Student titles: Group A / Group B / Group C only
- Dense structure: short bullets, 2-4 tasks per group
Return ONLY JSON:
{
  "teacherPlanLite":{
    "standardGist":"...",
    "flexibleGroupingNote":"groups are revisable based on evidence",
    "whyThisWorks":["...","..."]
  },
  "tiers":[{
    "group":"A"|"B"|"C",
    "level":"below"|"at"|"above",
    "title":"Group A",
    "intro":"...",
    "tasks":[{"id":"a1","prompt":"...","supportNote":"optional"}],
    "exitCheck":"...",
    "ifYouFinishEarly":"..."
  }]
}`,
      user: JSON.stringify({
        grade: params.grade,
        skill: params.skill,
        componentId: params.componentId,
        sourceStudySheet: params.sheet,
      }),
    });

    const tiers: DiffTier[] = (llm.tiers ?? [])
      .map((t, i) => {
        const defaults: DiffGroup[] = ["A", "B", "C"];
        const levels: DiffTier["level"][] = ["below", "at", "above"];
        const group = asGroup(t.group, defaults[i] ?? "B");
        const level = asLevel(t.level, levels[i] ?? "at");
        const tasks = (t.tasks ?? [])
          .map((task, j) => ({
            id: String(task.id ?? `${group.toLowerCase()}${j + 1}`),
            prompt: String(task.prompt ?? "").trim(),
            supportNote: task.supportNote
              ? String(task.supportNote).trim()
              : undefined,
          }))
          .filter((task) => task.prompt);
        return {
          group,
          level,
          title: String(t.title ?? `Group ${group}`),
          intro: String(t.intro ?? "").trim(),
          tasks,
          exitCheck: t.exitCheck ? String(t.exitCheck) : undefined,
          ifYouFinishEarly: t.ifYouFinishEarly
            ? String(t.ifYouFinishEarly)
            : undefined,
        } satisfies DiffTier;
      })
      .filter((t) => t.tasks.length >= 1);

    if (tiers.length >= 3) {
      return {
        componentId: params.componentId,
        sourceSheetTitle: params.sheet.title,
        teacherPlanLite: {
          standardGist: String(
            llm.teacherPlanLite?.standardGist ?? params.skill,
          ),
          flexibleGroupingNote: String(
            llm.teacherPlanLite?.flexibleGroupingNote ??
              base.teacherPlanLite.flexibleGroupingNote,
          ),
          whyThisWorks: (llm.teacherPlanLite?.whyThisWorks ??
            base.teacherPlanLite.whyThisWorks)
            .map(String)
            .slice(0, 4),
        },
        tiers: tiers.slice(0, 3),
      };
    }
  } catch (err) {
    logError("Differentiate LLM failed", err);
  }

  return base;
}
