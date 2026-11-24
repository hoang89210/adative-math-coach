import type { PracticeQuestion, StudySheet } from "./quiz";

export type CfuRigor =
  | "conceptual"
  | "procedural"
  | "application"
  | "mixed";

export type CfuResponseRoute = {
  choice: string;
  reveals: string;
  nextStep: string;
};

export type CfuItem = {
  id: string;
  stem: string;
  type: "multiple_choice" | "short_answer";
  options?: string[];
  correct_answer: string;
  responseRoutes: CfuResponseRoute[];
};

export type CfuCheck = {
  focus: string;
  rigor: CfuRigor;
  items: CfuItem[];
  componentId: string;
};

export type CfuInterpretation = {
  itemId: string;
  studentAnswer: string;
  matchedRoute: CfuResponseRoute | null;
  isCorrect: boolean;
  feedback: string;
};

export type DiffGroup = "A" | "B" | "C";

export type DiffTierTask = {
  id: string;
  prompt: string;
  supportNote?: string;
};

export type DiffTier = {
  group: DiffGroup;
  /** teacher/helper only — never show raw label to student as ability track */
  level: "below" | "at" | "above";
  title: string;
  intro: string;
  tasks: DiffTierTask[];
  exitCheck?: string;
  ifYouFinishEarly?: string;
};

export type DifferentiationPackage = {
  componentId: string;
  sourceSheetTitle: string;
  teacherPlanLite: {
    standardGist: string;
    flexibleGroupingNote: string;
    whyThisWorks: string[];
  };
  tiers: DiffTier[];
};

export type TeacherLesson = {
  componentId: string;
  skill: string;
  grade: string;
  title: string;
  standardGist: string;
  learningGoal: string;
  launch: string;
  exploreKeyTask: string;
  discuss: string;
  exit: string;
  observationLookFors: string[];
  materials: string[];
  markdown: string;
  createdAt: string;
};

export type TeacherPrepState = {
  componentId: string;
  lessonTitle: string;
  keyTask: string;
  turns: Array<{ role: "coach" | "teacher"; text: string }>;
  prepNoteMarkdown?: string;
  status: "active" | "finalized";
};

export type SessionArtifacts = {
  studySheets?: Record<string, StudySheet>;
  cfus?: Record<string, CfuCheck>;
  differentiations?: Record<string, DifferentiationPackage>;
  quizzes?: Record<
    string,
    { description: string; questions: PracticeQuestion[] }
  >;
  teacherLessons?: Record<string, TeacherLesson>;
  teacherPrep?: Record<string, TeacherPrepState>;
};
