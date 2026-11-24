import fs from "fs";
import path from "path";

type ProgressionIndex = {
  builtAt: string;
  edgeCount: number;
  buildsTowards: Record<string, string[]>;
  /** standardId -> list of prerequisite standard ids (sources that build towards it) */
  prerequisitesOf: Record<string, string[]>;
};

let cached: ProgressionIndex | null = null;

function loadProgression(): ProgressionIndex | null {
  if (cached) return cached;
  const p = path.join(process.cwd(), "data", "progression-index.json");
  if (!fs.existsSync(p)) return null;
  cached = JSON.parse(fs.readFileSync(p, "utf8")) as ProgressionIndex;
  return cached;
}

/**
 * Score lower = learn earlier.
 * Uses buildsTowards: if A buildsTowards B, A should come before B.
 * Among weak skills, ones that are prerequisites of other weak skills rank first.
 */
export function orderComponentsByProgression(
  items: Array<{
    componentId: string;
    description: string;
    correct: number;
    total: number;
    standardIds: string[];
  }>,
): Array<{
  componentId: string;
  description: string;
  correct: number;
  total: number;
  standardIds: string[];
  dependsOnStandardIds: string[];
  progressionRank: number;
}> {
  const prog = loadProgression();
  const allStd = new Set(items.flatMap((i) => i.standardIds));

  // For each component, how many other weak-standards it is a prereq for
  const prereqFanout = new Map<string, number>();
  const dependsMap = new Map<string, string[]>();

  for (const item of items) {
    let fanout = 0;
    const deps = new Set<string>();
    for (const sid of item.standardIds) {
      const children = prog?.buildsTowards[sid] ?? [];
      for (const child of children) {
        if (allStd.has(child)) fanout += 1;
      }
      const prereqs = prog?.prerequisitesOf[sid] ?? [];
      for (const pre of prereqs) {
        if (allStd.has(pre)) deps.add(pre);
      }
    }
    prereqFanout.set(item.componentId, fanout);
    dependsMap.set(item.componentId, [...deps]);
  }

  const ranked = items.map((item) => {
    const missRate =
      item.total > 0 ? (item.total - item.correct) / item.total : 1;
    const fanout = prereqFanout.get(item.componentId) ?? 0;
    // Lower rank = earlier. Prefer: is prereq for others, then higher miss rate
    const progressionRank = -(fanout * 10) - missRate * 5;
    return {
      ...item,
      dependsOnStandardIds: dependsMap.get(item.componentId) ?? [],
      progressionRank,
    };
  });

  ranked.sort((a, b) => {
    if (a.progressionRank !== b.progressionRank) {
      return a.progressionRank - b.progressionRank;
    }
    const missA = a.total - a.correct;
    const missB = b.total - b.correct;
    if (missA !== missB) return missB - missA;
    return a.description.localeCompare(b.description);
  });

  return ranked;
}

export function priorityTier(
  index: number,
  total: number,
): "high" | "medium" | "later" {
  if (index < Math.max(1, Math.ceil(total * 0.34))) return "high";
  if (index < Math.max(2, Math.ceil(total * 0.67))) return "medium";
  return "later";
}
