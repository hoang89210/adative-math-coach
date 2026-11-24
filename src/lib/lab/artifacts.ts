import { loadMastery, resolveSessionId } from "@/lib/mastery";
import type { LabArtifactOption } from "./types";

export async function listLabArtifacts(sessionInput: string): Promise<{
  sessionId: string;
  grade: string;
  artifacts: LabArtifactOption[];
}> {
  const sessionId = await resolveSessionId(sessionInput);
  if (!sessionId) throw new Error("session not found");
  const session = await loadMastery(sessionId);
  if (!session) throw new Error("session not found");

  const artifacts: LabArtifactOption[] = [];
  const arts = session.artifacts ?? {};

  for (const [componentId, cfu] of Object.entries(arts.cfus ?? {})) {
    cfu.items.forEach((item, i) => {
      artifacts.push({
        id: `cfu:${componentId}:${item.id}`,
        source: "cfu",
        label: `CFU · ${cfu.focus.slice(0, 48)} · item ${i + 1}`,
        text: item.stem,
        componentId,
        statementCodes:
          session.roadmap?.priorities?.find((p) => p.componentId === componentId)
            ?.standardCodes ?? [],
      });
    });
  }

  for (const [componentId, quiz] of Object.entries(arts.quizzes ?? {})) {
    quiz.questions.forEach((q, i) => {
      artifacts.push({
        id: `quiz:${componentId}:${q.id}`,
        source: "quiz",
        label: `Quiz · ${quiz.description.slice(0, 40)} · Q${i + 1}`,
        text: q.question,
        componentId,
        statementCodes:
          session.roadmap?.priorities?.find((p) => p.componentId === componentId)
            ?.standardCodes ?? [],
      });
    });
  }

  for (const [componentId, sheet] of Object.entries(arts.studySheets ?? {})) {
    artifacts.push({
      id: `sheet:${componentId}`,
      source: "study-sheet",
      label: `Study sheet · ${sheet.title.slice(0, 48)}`,
      text: [sheet.skillSummary, sheet.keyIdea, sheet.workedExample.problem]
        .filter(Boolean)
        .join("\n\n"),
      componentId,
      statementCodes:
        session.roadmap?.priorities?.find((p) => p.componentId === componentId)
          ?.standardCodes ?? [],
    });
  }

  for (const [componentId, lesson] of Object.entries(
    arts.teacherLessons ?? {},
  )) {
    artifacts.push({
      id: `lesson:${componentId}`,
      source: "lesson-key-task",
      label: `Lesson key task · ${lesson.title.slice(0, 40)}`,
      text: lesson.exploreKeyTask,
      componentId,
      statementCodes:
        session.roadmap?.priorities?.find((p) => p.componentId === componentId)
          ?.standardCodes ?? [],
    });
  }

  if (artifacts.length === 0) {
    for (const p of session.roadmap?.priorities ?? []) {
      artifacts.push({
        id: `priority:${p.componentId}`,
        source: "standalone",
        label: `Plan skill · ${p.skill.slice(0, 48)}`,
        text: `${p.skill}\n\n${p.whyNow}\n\n${p.masteryLooksLike}`,
        componentId: p.componentId,
        statementCodes: p.standardCodes ?? [],
      });
    }
  }

  return { sessionId, grade: session.grade, artifacts };
}
