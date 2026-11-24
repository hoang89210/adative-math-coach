export type QuestionType = "multiple_choice" | "short_answer";

export type DiagnosticQuestion = {
  id: string;
  question: string;
  type: QuestionType;
  options?: string[];
  correct_answer: string;
  target_component_id: string;
  explanation: string;
};

export type DiagnosticTest = {
  grade: string;
  questions: DiagnosticQuestion[];
  components: Array<{ id: string; description: string }>;
};

export type AnswerSubmission = {
  questionId: string;
  answer: string;
};

export type ComponentResult = {
  componentId: string;
  description: string;
  correct: number;
  total: number;
  mastered: boolean;
};

export type GradeResult = {
  grade: string;
  score: number;
  total: number;
  percent: number;
  byComponent: ComponentResult[];
  weakComponents: ComponentResult[];
  strongComponents: ComponentResult[];
};

/** @deprecated kept for old sessions */
export type RoadmapStep = {
  step: number;
  componentId: string;
  title: string;
  description: string;
  focus: string;
};

export type CoachPriority = {
  order: number;
  componentId: string;
  skill: string;
  whyNow: string;
  masteryLooksLike: string;
  studyMoves: string[];
  dependsOn: string[];
  priority: "high" | "medium" | "later";
  standardCodes: string[];
};

export type Roadmap = {
  summary: string;
  /** Coach-plan priorities (preferred) */
  priorities?: CoachPriority[];
  strengthsToKeep?: string[];
  nextCheckpoint?: string;
  /** Legacy field — optional for old sessions */
  steps?: RoadmapStep[];
};

export type PracticeQuestion = {
  id: string;
  question: string;
  type: QuestionType;
  options?: string[];
  correct_answer: string;
  target_component_id: string;
  explanation: string;
};

export type StudySheet = {
  title: string;
  skillSummary: string;
  keyIdea: string;
  workedExample: {
    problem: string;
    solution: string;
  };
  commonMistakes: string[];
  tryOnYourOwnTips: string[];
  encouragement: string;
};
