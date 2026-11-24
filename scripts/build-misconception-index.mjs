import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.resolve(root, "..", "data");
const nodesPath = path.join(dataDir, "nodes.jsonl");
const relationshipsPath = path.join(dataDir, "relationships.jsonl");
const mathIndexPath = path.join(root, "data", "math-index.json");
const outPath = path.join(root, "data", "misconception-index.json");

async function* iterateJsonl(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const t = line.trim();
      if (!t) continue;
      yield JSON.parse(t);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

async function main() {
  console.log("Loading misconceptions...");
  const misconceptions = {};
  let n = 0;
  for await (const node of iterateJsonl(nodesPath)) {
    n++;
    if (n % 150000 === 0) console.log("  nodes", n);
    if (!node.labels?.includes("Misconception")) continue;
    const props = node.properties || {};
    if (props.academicSubject && props.academicSubject !== "Mathematics")
      continue;
    const id = node.identifier || props.identifier;
    const description = props.description;
    if (!id || !description) continue;
    misconceptions[id] = {
      id,
      description,
      tokens: tokens(description),
    };
  }
  console.log("misconceptions", Object.keys(misconceptions).length);

  // hinders: misconception -> target
  const byTarget = {};
  let r = 0;
  for await (const rel of iterateJsonl(relationshipsPath)) {
    r++;
    if (r % 200000 === 0) console.log("  rels", r);
    if (rel.label !== "hinders") continue;
    if (!rel.source_labels?.includes("Misconception")) continue;
    const mid = rel.source_identifier;
    const tid = rel.target_identifier;
    if (!mid || !tid || !misconceptions[mid]) continue;
    if (!byTarget[tid]) byTarget[tid] = [];
    byTarget[tid].push(mid);
  }

  // Map components via keyword overlap with misconceptions
  const mathIndex = JSON.parse(fs.readFileSync(mathIndexPath, "utf8"));
  const byComponentId = {};
  const list = Object.values(misconceptions);

  for (const comps of Object.values(mathIndex.byGrade || {})) {
    for (const c of comps) {
      if (byComponentId[c.id]) continue;
      const ct = new Set(tokens(c.description));
      const scored = [];
      for (const m of list) {
        let hit = 0;
        for (const t of m.tokens) if (ct.has(t)) hit++;
        if (hit >= 2) scored.push({ id: m.id, score: hit });
      }
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, 8).map((s) => s.id);
      // also attach via related standard ids if present in byTarget
      for (const s of c.relatedStandards || []) {
        for (const mid of byTarget[s.id] || []) {
          if (!top.includes(mid)) top.push(mid);
        }
      }
      if (top.length) {
        byComponentId[c.id] = top.slice(0, 12).map((id) => ({
          id,
          description: misconceptions[id].description,
        }));
      }
    }
  }

  const payload = {
    builtAt: new Date().toISOString(),
    misconceptionCount: Object.keys(misconceptions).length,
    componentsWithHints: Object.keys(byComponentId).length,
    byComponentId,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log(
    `Wrote ${outPath} componentsWithHints=${payload.componentsWithHints}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
