export type LabArtifactSource =
  | "standalone"
  | "diagnostic"
  | "cfu"
  | "quiz"
  | "lesson-key-task"
  | "study-sheet";

export type MathAlignmentLcResult = {
  identifier: string;
  description: string;
  reasoning: string;
  aligned: boolean;
  feedback: string | null;
};

export type MathAlignmentResult = {
  evaluator: "math-standards-alignment";
  mode: "lab-openai" | "learning-commons-sdk";
  question: string;
  statement_code: string;
  jurisdiction: string;
  case_identifier_uuid: string | null;
  learning_components: MathAlignmentLcResult[];
  aligned_count: number;
  total_count: number;
  summary: string;
};

export type GradeLevelResult = {
  evaluator: "grade-level-appropriateness";
  mode: "lab-openai" | "learning-commons-sdk";
  text: string;
  target_grade?: string;
  reasoning: string;
  grade_band: "K-1" | "2-3" | "4-5" | "6-8" | "9-10" | "11-12";
  alternative_grade_band: "K-1" | "2-3" | "4-5" | "6-8" | "9-10" | "11-12";
  scaffolding_needed: string;
  fit_note: string;
};

export type LabArtifactOption = {
  id: string;
  source: LabArtifactSource;
  label: string;
  text: string;
  componentId?: string;
  statementCodes?: string[];
};
