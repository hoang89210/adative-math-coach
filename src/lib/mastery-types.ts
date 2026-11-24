import type {
  GradeResult,
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

export type MasteryRecord = {
  id: string;
  createdAt: string;
  grade: string;
  result: GradeResult;
  roadmap?: Roadmap;
  artifacts?: SessionArtifacts;
};

export type {
  CfuCheck,
  DifferentiationPackage,
  PracticeQuestion,
  Roadmap,
  SessionArtifacts,
  StudySheet,
  TeacherLesson,
  TeacherPrepState,
};
