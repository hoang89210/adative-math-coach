export type QuestionType = "multiple_choice" | "short_answer";

export type DiagnosticQuestion = {
  id: string;
  question: string;
  type: QuestionType;
  options?: string[];
  correct_answer: string;
  target_component_id: string;
  /**
   * Optional: all learning components the item assesses. When present the
   * LC mastery update splits one unit of evidence 1/k across them.
   */
  target_component_ids?: string[];
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

export type FoundationStep = {
  /** review: "Ôn nền tảng: X trước khi tiếp Y"; diagnose: quick checks first */
  kind?: "review" | "diagnose";
  suggestion: string;
  rootStandardId: string | null;
  rootLabel: string | null;
  /** diagnose: direct prerequisites without data */
  checkLabels?: string[];
  targetStandardId: string;
  targetLabel: string;
  /** representative LC (root LC for review, first probe LC for diagnose) */
  rootLcId: string | null;
  depth: number;
  /** "real" = Learning Commons KG path; "heuristic" = same domain, lower grade */
  dataSource: "real" | "heuristic";
  rootState: "mastered" | "gap" | "learning" | "insufficient" | null;
  diagnostics: Array<{ lcId: string; skill: string; prompt: string }>;
};

export type Roadmap = {
  summary: string;
  /** Root-gap foundations to review first (computed from LC mastery) */
  foundations?: FoundationStep[];
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
