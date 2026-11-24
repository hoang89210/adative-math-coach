import { callLlmJson, hasLlmKey } from "@/lib/llm";
import type { StudySheet } from "@/lib/types/quiz";
import type { TeacherLesson } from "@/lib/types/skills";

type LlmLesson = {
  title?: string;
  standardGist?: string;
  learningGoal?: string;
  launch?: string;
  exploreKeyTask?: string;
  discuss?: string;
  exit?: string;
  observationLookFors?: string[];
  materials?: string[];
};

function toMarkdown(lesson: Omit<TeacherLesson, "markdown" | "createdAt">) {
  const lines = [
    `# ${lesson.title}`,
    ``,
    `**Grade:** ${lesson.grade}  `,
    `**Skill focus:** ${lesson.skill}`,
    ``,
    `## Standard gist`,
    lesson.standardGist,
    ``,
    `## Learning goal`,
    lesson.learningGoal,
    ``,
    `## Launch`,
    lesson.launch,
    ``,
    `## Explore (key student task)`,
    lesson.exploreKeyTask,
    ``,
    `## Discuss`,
    lesson.discuss,
    ``,
    `## Exit / check`,
    lesson.exit,
    ``,
    `## Observation look-fors`,
    ...lesson.observationLookFors.map((x) => `- ${x}`),
    ``,
    `## Materials`,
    ...lesson.materials.map((x) => `- ${x}`),
    ``,
  ];
  return lines.join("\n");
}

function fallbackLesson(params: {
  componentId: string;
  skill: string;
  grade: string;
  sheet?: StudySheet | null;
}): TeacherLesson {
  const base = {
    componentId: params.componentId,
    skill: params.skill,
    grade: params.grade,
    title: `Lesson: ${params.skill}`,
    standardGist: `Grade ${params.grade} mathematics — ${params.skill}`,
    learningGoal: `Students will make progress on “${params.skill}” and explain their reasoning.`,
    launch: `Activate prior knowledge with a quick notice/wonder related to ${params.skill}.`,
    exploreKeyTask:
      params.sheet?.workedExample.problem ||
      `Students work a grade-level task on ${params.skill}, showing their method.`,
    discuss: `Select 2–3 student strategies. Compare what is the same/different and name the key idea.`,
    exit: `One prompt: “How do you know your answer makes sense for ${params.skill}?”`,
    observationLookFors: [
      "Uses a representation that matches the idea",
      "Explains why a step works (not only what to do)",
      "Catches an unreasonable answer",
    ],
    materials: [
      params.sheet?.title || "Study sheet (optional)",
      "Whiteboard / paper",
      "Manipulatives if useful for the skill",
    ],
  };
  return {
    ...base,
    markdown: toMarkdown(base),
    createdAt: new Date().toISOString(),
  };
}

export async function generateTeacherLesson(params: {
  componentId: string;
  skill: string;
  grade: string;
  whyNow?: string | null;
  masteryLooksLike?: string | null;
  standardCodes?: string[];
  sheet?: StudySheet | null;
}): Promise<TeacherLesson> {
  const base = fallbackLesson(params);
  if (!hasLlmKey()) return base;

  try {
    const llm = await callLlmJson<LlmLesson>({
      system: `You write a SHORT teacher-ready math lesson outline for ONE skill.
Pedagogy adapted from Learning Commons k12-lesson-plan-creation (math), simplified for web MVP:
- One lesson block (not a multi-day unit)
- Include launch, explore key task, discuss, exit
- Observation look-fors are concrete student behaviors
- Teacher language; classroom-ready; no publisher attribution
Return ONLY JSON:
{
  "title":"...",
  "standardGist":"code or gist",
  "learningGoal":"...",
  "launch":"...",
  "exploreKeyTask":"the key student task, fully stated",
  "discuss":"...",
  "exit":"...",
  "observationLookFors":["...","...","..."],
  "materials":["..."]
}`,
      user: JSON.stringify({
        grade: params.grade,
        skill: params.skill,
        whyNow: params.whyNow ?? null,
        masteryLooksLike: params.masteryLooksLike ?? null,
        standardCodes: params.standardCodes ?? [],
        studySheet: params.sheet
          ? {
              title: params.sheet.title,
              keyIdea: params.sheet.keyIdea,
              example: params.sheet.workedExample,
            }
          : null,
      }),
    });

    const draft = {
      componentId: params.componentId,
      skill: params.skill,
      grade: params.grade,
      title: String(llm.title ?? base.title),
      standardGist: String(llm.standardGist ?? base.standardGist),
      learningGoal: String(llm.learningGoal ?? base.learningGoal),
      launch: String(llm.launch ?? base.launch),
      exploreKeyTask: String(llm.exploreKeyTask ?? base.exploreKeyTask),
      discuss: String(llm.discuss ?? base.discuss),
      exit: String(llm.exit ?? base.exit),
      observationLookFors: (llm.observationLookFors ?? base.observationLookFors)
        .map(String)
        .filter(Boolean)
        .slice(0, 6),
      materials: (llm.materials ?? base.materials)
        .map(String)
        .filter(Boolean)
        .slice(0, 8),
    };

    if (!draft.exploreKeyTask || !draft.learningGoal) return base;

    return {
      ...draft,
      markdown: toMarkdown(draft),
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("Teacher lesson LLM failed", err);
    return base;
  }
}
