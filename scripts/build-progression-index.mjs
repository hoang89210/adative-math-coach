import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

/**
 * Builds data/progression-index.json from the Learning Commons Knowledge
 * Graph JSONL exports (nodes.jsonl + relationships.jsonl).
 *
 * Real prerequisite data used:
 *   - `buildsTowards` (StandardsFrameworkItem -> StandardsFrameworkItem,
 *     CCSS / Multi-State, author: Student Achievement Partners)
 *   - `hasStandardAlignment` (state standard -> CCSS standard,
 *     author: Learning Commons) so state standards can reuse the CCSS
 *     progression.
 *
 * IMPORTANT (id space): `relationships.jsonl` puts the node `identifier`
 * in `source_identifier` / `target_identifier`, while `math-index.json`
 * keys standards by `caseIdentifierUUID`. v1 of this index stored the raw
 * node identifiers, so none of its 757 edges matched a math-index
 * standard. v2 translates every endpoint to `caseIdentifierUUID`.
 *
 * Input dir: $KG_DATA_DIR, else ../data (monorepo layout).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = process.env.KG_DATA_DIR
  ? path.resolve(process.env.KG_DATA_DIR)
  : path.resolve(root, "..", "data");
const nodesPath = path.join(dataDir, "nodes.jsonl");
const relationshipsPath = path.join(dataDir, "relationships.jsonl");
const outPath = path.join(root, "data", "progression-index.json");

async function* iterateJsonl(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

function push(map, k, v) {
  if (!map[k]) map[k] = [];
  if (!map[k].includes(v)) map[k].push(v);
}

async function main() {
  /** node identifier -> caseIdentifierUUID (math standards only) */
  const toCase = new Map();
  /** caseIdentifierUUID -> { code, jurisdiction } */
  const info = new Map();

  for await (const node of iterateJsonl(nodesPath)) {
    if (!node?.labels?.includes("StandardsFrameworkItem")) continue;
    const p = node.properties ?? {};
    if (p.academicSubject !== "Mathematics") continue;
    const caseId = p.caseIdentifierUUID || node.identifier;
    if (!caseId) continue;
    if (node.identifier) toCase.set(node.identifier, caseId);
    toCase.set(caseId, caseId);
    info.set(caseId, {
      code: p.statementCode ?? null,
      jurisdiction: p.jurisdiction || "Multi-State",
    });
  }

  const resolve = (id) => (id ? toCase.get(id) ?? null : null);

  const buildsTowards = {};
  const prerequisitesOf = {};
  const alignedToCcss = {};
  const codes = {};
  let edgeCount = 0;
  let alignmentCount = 0;
  let unresolved = 0;

  for await (const rel of iterateJsonl(relationshipsPath)) {
    if (rel.label === "buildsTowards") {
      const s = resolve(rel.source_identifier);
      const t = resolve(rel.target_identifier);
      if (!s || !t) {
        unresolved += 1;
        continue;
      }
      push(buildsTowards, s, t);
      push(prerequisitesOf, t, s);
      for (const id of [s, t]) {
        const c = info.get(id)?.code;
        if (c) codes[id] = c;
      }
      edgeCount += 1;
    } else if (rel.label === "hasStandardAlignment") {
      const s = resolve(rel.source_identifier);
      const t = resolve(rel.target_identifier);
      if (!s || !t) continue;
      push(alignedToCcss, s, t);
      alignmentCount += 1;
    }
  }

  // Only keep alignments whose CCSS target participates in the progression;
  // others add size without enabling any prerequisite lookup.
  const inGraph = new Set([
    ...Object.keys(buildsTowards),
    ...Object.keys(prerequisitesOf),
  ]);
  let keptAlignments = 0;
  for (const [s, targets] of Object.entries(alignedToCcss)) {
    const kept = targets.filter((t) => inGraph.has(t));
    if (kept.length) {
      alignedToCcss[s] = kept;
      keptAlignments += kept.length;
    } else {
      delete alignedToCcss[s];
    }
  }

  const payload = {
    version: 2,
    builtAt: new Date().toISOString(),
    idSpace: "caseIdentifierUUID",
    source:
      "Learning Commons Knowledge Graph: buildsTowards (Student Achievement Partners, CC0) + hasStandardAlignment (Learning Commons, CC BY 4.0)",
    edgeCount,
    alignmentCount: keptAlignments,
    buildsTowards,
    prerequisitesOf,
    alignedToCcss,
    codes,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log(
    `Wrote ${outPath} edges=${edgeCount} unresolved=${unresolved} alignments(all)=${alignmentCount} alignments(kept)=${keptAlignments}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
