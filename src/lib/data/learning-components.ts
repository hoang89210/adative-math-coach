import fs from "fs";
import path from "path";
import type { LearningComponent, RelatedStandard } from "./types";

type MathIndexFile = {
  builtAt: string;
  gradeSummary: Record<string, number>;
  byGrade: Record<string, LearningComponent[]>;
};

let cachedIndex: MathIndexFile | null = null;

function getIndexPath() {
  return path.join(process.cwd(), "data", "math-index.json");
}

function loadIndex(): MathIndexFile {
  if (cachedIndex) return cachedIndex;
  const indexPath = getIndexPath();
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `Missing math index at ${indexPath}. Run: node scripts/build-math-index.mjs`,
    );
  }
  const raw = fs.readFileSync(indexPath, "utf8");
  cachedIndex = JSON.parse(raw) as MathIndexFile;
  return cachedIndex;
}

function normalizeGrade(grade: string): string | null {
  const g = String(grade).trim();
  if (!g) return null;
  if (/^k$/i.test(g)) return "K";
  if (/^\d{1,2}$/.test(g)) return String(Number(g));
  return null;
}

function matchesJurisdiction(
  c: LearningComponent,
  jurisdiction?: string,
): boolean {
  const jur = jurisdiction?.trim();
  if (!jur || jur === "All") return true;
  if (jur === "Multi-State") {
    return c.relatedStandards.some(
      (s) => !s.jurisdiction || s.jurisdiction === "Multi-State",
    );
  }
  return c.relatedStandards.some(
    (s) => s.jurisdiction === jur || s.jurisdiction === "Multi-State",
  );
}

export async function getLearningComponentsByGrade(
  grade: string,
  jurisdiction?: string,
): Promise<LearningComponent[]> {
  const key = normalizeGrade(grade);
  if (!key) return [];

  const index = loadIndex();
  const list = index.byGrade[key] ?? [];
  if (!jurisdiction?.trim() || jurisdiction === "All") return list;

  const filtered = list.filter((c) => matchesJurisdiction(c, jurisdiction));
  // fallback if state filter too strict
  return filtered.length >= 5 ? filtered : list;
}

export async function getMathIndexStats() {
  const index = loadIndex();
  return {
    builtAt: index.builtAt,
    gradeSummary: index.gradeSummary,
  };
}

export async function getComponentsByIds(
  grade: string,
  ids: string[],
): Promise<LearningComponent[]> {
  const all = await getLearningComponentsByGrade(grade);
  const wanted = new Set(ids);
  const found = all.filter((c) => wanted.has(c.id));
  // if some ids missing from grade filter, scan all grades once
  if (found.length === ids.length) return found;

  // Ids outside this grade: use the all-grade union (complete standards list).
  const byGrade = new Map(found.map((c) => [c.id, c]));
  const union = getStandardIndex().components;
  return ids
    .map((id) => byGrade.get(id) ?? union.get(id))
    .filter(Boolean) as LearningComponent[];
}

export function pickComponentsForDiagnostic(
  components: LearningComponent[],
  count = 7,
): LearningComponent[] {
  if (components.length <= count) return [...components];

  // Prefer components with standard codes (more concrete skills)
  const scored = components.map((c) => ({
    c,
    score:
      (c.relatedStandards.some((s) => s.code) ? 2 : 0) +
      Math.min(c.relatedStandards.length, 3),
  }));
  scored.sort((a, b) => b.score - a.score || a.c.description.localeCompare(b.c.description));

  const top = scored.slice(0, Math.min(scored.length, count * 4));
  // shuffle top pool lightly
  for (let i = top.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [top[i], top[j]] = [top[j], top[i]];
  }
  return top.slice(0, count).map((x) => x.c);
}

export type StandardIndexEntry = {
  id: string;
  code: string | null;
  description: string;
  gradeLevel: string[];
  jurisdiction: string;
  /** LCs that `supports` this standard (math-index) */
  lcIds: string[];
};

type StandardIndex = {
  standards: Map<string, StandardIndexEntry>;
  components: Map<string, LearningComponent>;
};

let cachedStandardIndex: StandardIndex | null = null;

function standardSortKey(s: RelatedStandard) {
  const ms = (s.jurisdiction || "Multi-State") === "Multi-State" ? 0 : 1;
  return [ms, s.code ? 0 : 1, s.jurisdiction || "", s.code || "", s.id] as const;
}

/** Deterministic order: Multi-State (CCSS) first, coded before uncoded, then code, id. */
export function compareRelatedStandards(a: RelatedStandard, b: RelatedStandard) {
  const ka = standardSortKey(a);
  const kb = standardSortKey(b);
  for (let i = 0; i < ka.length; i++) {
    const x = ka[i];
    const y = kb[i];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y), "en", { numeric: true });
  }
  return 0;
}

/**
 * Merge the per-grade copies of each LC. math-index.json stores an LC once
 * per grade with ONLY that grade's standards, so taking the first copy
 * (grade 1 before 4, K last) loses standards. Pure + exported for tests.
 */
export function unionComponents(
  byGrade: Record<string, LearningComponent[]>,
): Map<string, LearningComponent> {
  const merged = new Map<string, { c: LearningComponent; seen: Set<string> }>();
  for (const list of Object.values(byGrade)) {
    for (const c of list) {
      let m = merged.get(c.id);
      if (!m) {
        m = { c: { id: c.id, description: c.description, relatedStandards: [] }, seen: new Set() };
        merged.set(c.id, m);
      }
      for (const s of c.relatedStandards) {
        if (m.seen.has(s.id)) continue;
        m.seen.add(s.id);
        m.c.relatedStandards.push(s);
      }
    }
  }
  const out = new Map<string, LearningComponent>();
  for (const [id, m] of merged) {
    m.c.relatedStandards.sort(compareRelatedStandards);
    out.set(id, m.c);
  }
  return out;
}

/**
 * Reverse index over math-index.json: standard -> supporting LCs, and
 * LC id -> component with the UNION of its standards across all grades.
 * Built once per server instance.
 */
export function getStandardIndex(): StandardIndex {
  if (cachedStandardIndex) return cachedStandardIndex;
  const index = loadIndex();
  const standards = new Map<string, StandardIndexEntry>();
  const components = unionComponents(index.byGrade);
  for (const list of Object.values(index.byGrade)) {
    for (const c of list) {
      for (const s of c.relatedStandards) {
        let e = standards.get(s.id);
        if (!e) {
          e = {
            id: s.id,
            code: s.code ?? null,
            description: s.description,
            gradeLevel: s.gradeLevel ?? [],
            jurisdiction: s.jurisdiction || "Multi-State",
            lcIds: [],
          };
          standards.set(s.id, e);
        }
        if (!e.lcIds.includes(c.id)) e.lcIds.push(c.id);
      }
    }
  }
  cachedStandardIndex = { standards, components };
  return cachedStandardIndex;
}
