export const GRADES_K12 = [
  "K",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
] as const;

export type GradeId = (typeof GRADES_K12)[number];

export const GRADE_BANDS: Array<{
  id: string;
  label: string;
  grades: GradeId[];
}> = [
  { id: "K-2", label: "K–2", grades: ["K", "1", "2"] },
  { id: "3-5", label: "3–5", grades: ["3", "4", "5"] },
  { id: "6-8", label: "6–8", grades: ["6", "7", "8"] },
  { id: "9-12", label: "9–12", grades: ["9", "10", "11", "12"] },
];

export function gradeLabel(g: string) {
  return g === "K" ? "Kindergarten" : `Grade ${g}`;
}

export function isHighSchoolGrade(grade: string) {
  const n = Number(grade);
  return Number.isFinite(n) && n >= 9;
}

export function diagnosticBandHint(grade: string): string {
  if (grade === "K" || grade === "1" || grade === "2") {
    return "early elementary: concrete numbers, counting, simple shapes; short sentences";
  }
  if (grade === "3" || grade === "4" || grade === "5") {
    return "upper elementary: multi-digit ops, fractions, measurement, basic geometry";
  }
  if (grade === "6" || grade === "7" || grade === "8") {
    return "middle school: ratios, expressions, equations, functions intro, geometry, stats";
  }
  return "high school: algebra, functions, geometry/proof language, advanced number/stats as appropriate — still no diagrams required";
}
