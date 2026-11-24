import fs from "fs";
import path from "path";
import type { LearningComponent } from "./types";

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

export async function getLearningComponentsByGrade(
  grade: string,
): Promise<LearningComponent[]> {
  const key = normalizeGrade(grade);
  if (!key) return [];

  const index = loadIndex();
  return index.byGrade[key] ?? [];
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

  const index = loadIndex();
  const byId = new Map<string, LearningComponent>();
  for (const list of Object.values(index.byGrade)) {
    for (const c of list) byId.set(c.id, c);
  }
  return ids.map((id) => byId.get(id)).filter(Boolean) as LearningComponent[];
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
