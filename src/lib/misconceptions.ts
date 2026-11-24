import fs from "fs";
import path from "path";

type MisconceptionHint = { id: string; description: string };

type MisconceptionIndex = {
  builtAt: string;
  byComponentId: Record<string, MisconceptionHint[]>;
};

let cached: MisconceptionIndex | null = null;

function loadIndex(): MisconceptionIndex | null {
  if (cached) return cached;
  const p = path.join(process.cwd(), "data", "misconception-index.json");
  if (!fs.existsSync(p)) return null;
  cached = JSON.parse(fs.readFileSync(p, "utf8")) as MisconceptionIndex;
  return cached;
}

export function getMisconceptionsForComponent(
  componentId: string,
  limit = 5,
): MisconceptionHint[] {
  const idx = loadIndex();
  if (!idx) return [];
  return (idx.byComponentId[componentId] ?? []).slice(0, limit);
}
