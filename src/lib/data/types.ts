export type KgNode = {
  type: "node";
  identifier: string;
  labels: string[];
  properties: Record<string, string | undefined>;
};

export type KgRelationship = {
  type: "relationship";
  identifier: string;
  label: string;
  source_identifier: string;
  source_labels: string[];
  target_identifier: string;
  target_labels: string[];
  properties: Record<string, string | undefined>;
};

export type RelatedStandard = {
  id: string;
  code: string | null;
  description: string;
  gradeLevel: string[];
  jurisdiction?: string;
};

export type LearningComponent = {
  id: string;
  description: string;
  relatedStandards: RelatedStandard[];
};
