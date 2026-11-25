import type {
  PracticeQuestion,
  Roadmap,
  StudySheet,
} from "./types/quiz";
import type {
  CfuCheck,
  DifferentiationPackage,
  SessionArtifacts,
  TeacherLesson,
  TeacherPrepState,
} from "./types/skills";
import type { MasteryRecord } from "./mastery-types";
import {
  storeLoad,
  storeResolveSessionId,
  storeSave,
} from "./session-store";

export type { MasteryRecord };

export async function saveMastery(record: MasteryRecord) {
  return storeSave(record);
}

export async function loadMastery(id: string): Promise<MasteryRecord | null> {
  return storeLoad(id);
}

export async function updateMasteryRoadmap(id: string, roadmap: Roadmap) {
  const existing = await loadMastery(id);
  if (!existing) throw new Error(`Session not found: ${id}`);
  existing.roadmap = roadmap;
  return saveMastery(existing);
}

async function withArtifacts(
  id: string,
  mutator: (a: SessionArtifacts) => void,
) {
  const existing = await loadMastery(id);
  if (!existing) throw new Error(`Session not found: ${id}`);
  if (!existing.artifacts) existing.artifacts = {};
  mutator(existing.artifacts);
  return saveMastery(existing);
}

export async function cacheStudySheet(
  sessionId: string,
  componentId: string,
  sheet: StudySheet,
) {
  return withArtifacts(sessionId, (a) => {
    if (!a.studySheets) a.studySheets = {};
    a.studySheets[componentId] = sheet;
  });
}

export async function getCachedStudySheet(
  sessionId: string,
  componentId: string,
) {
  return (
    (await loadMastery(sessionId))?.artifacts?.studySheets?.[componentId] ??
    null
  );
}

export async function cacheCfu(
  sessionId: string,
  componentId: string,
  cfu: CfuCheck,
) {
  return withArtifacts(sessionId, (a) => {
    if (!a.cfus) a.cfus = {};
    a.cfus[componentId] = cfu;
  });
}

export async function getCachedCfu(sessionId: string, componentId: string) {
  return (await loadMastery(sessionId))?.artifacts?.cfus?.[componentId] ?? null;
}

export async function cacheDifferentiation(
  sessionId: string,
  componentId: string,
  pack: DifferentiationPackage,
) {
  return withArtifacts(sessionId, (a) => {
    if (!a.differentiations) a.differentiations = {};
    a.differentiations[componentId] = pack;
  });
}

export async function getCachedDifferentiation(
  sessionId: string,
  componentId: string,
) {
  return (
    (await loadMastery(sessionId))?.artifacts?.differentiations?.[
      componentId
    ] ?? null
  );
}

export async function cacheQuiz(
  sessionId: string,
  componentId: string,
  payload: { description: string; questions: PracticeQuestion[] },
) {
  return withArtifacts(sessionId, (a) => {
    if (!a.quizzes) a.quizzes = {};
    a.quizzes[componentId] = payload;
  });
}

export async function cacheTeacherLesson(
  sessionId: string,
  componentId: string,
  lesson: TeacherLesson,
) {
  return withArtifacts(sessionId, (a) => {
    if (!a.teacherLessons) a.teacherLessons = {};
    a.teacherLessons[componentId] = lesson;
  });
}

export async function getCachedTeacherLesson(
  sessionId: string,
  componentId: string,
) {
  return (
    (await loadMastery(sessionId))?.artifacts?.teacherLessons?.[componentId] ??
    null
  );
}

export async function cacheTeacherPrep(
  sessionId: string,
  componentId: string,
  prep: TeacherPrepState,
) {
  return withArtifacts(sessionId, (a) => {
    if (!a.teacherPrep) a.teacherPrep = {};
    a.teacherPrep[componentId] = prep;
  });
}

export async function getCachedTeacherPrep(
  sessionId: string,
  componentId: string,
) {
  return (
    (await loadMastery(sessionId))?.artifacts?.teacherPrep?.[componentId] ??
    null
  );
}

export async function resolveSessionId(input: string): Promise<string | null> {
  return storeResolveSessionId(input);
}

export { sessionShortCode } from "./mastery-codes";
