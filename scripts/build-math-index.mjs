import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.resolve(root, "..", "data");
const nodesPath = path.join(dataDir, "nodes.jsonl");
const relationshipsPath = path.join(dataDir, "relationships.jsonl");
const outPath = path.join(root, "data", "math-index.json");

function parseGradeLevel(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // ignore
  }
  return [String(raw).replace(/[\[\]"]/g, "")].filter(Boolean);
}

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

async function main() {
  console.log("Scanning nodes...");
  const components = {};
  const standards = {};
  let nodeCount = 0;

  for await (const node of iterateJsonl(nodesPath)) {
    nodeCount++;
    if (nodeCount % 100000 === 0) console.log(`  nodes: ${nodeCount}`);
    if (!node?.labels?.length) continue;
    const props = node.properties ?? {};
    const subject = props.academicSubject;

    if (node.labels.includes("LearningComponent") && subject === "Mathematics") {
      const id = node.identifier || props.identifier;
      if (!id || !props.description) continue;
      components[id] = { id, description: props.description };
      continue;
    }

    if (
      node.labels.includes("StandardsFrameworkItem") &&
      subject === "Mathematics"
    ) {
      const primary =
        props.caseIdentifierUUID || node.identifier || props.identifier;
      if (!primary) continue;
      const entry = {
        id: primary,
        code: props.statementCode ?? null,
        description: props.description ?? "",
        gradeLevel: parseGradeLevel(props.gradeLevel),
        jurisdiction: props.jurisdiction || "Multi-State",
      };
      standards[primary] = entry;
      if (node.identifier) standards[node.identifier] = entry;
      if (props.identifier) standards[props.identifier] = entry;
      if (props.caseIdentifierUUID) standards[props.caseIdentifierUUID] = entry;
    }
  }

  console.log(`Nodes done. components=${Object.keys(components).length} standards≈${Object.keys(standards).length}`);
  console.log("Scanning relationships...");

  const supports = {};
  let relCount = 0;
  for await (const rel of iterateJsonl(relationshipsPath)) {
    relCount++;
    if (relCount % 200000 === 0) console.log(`  rels: ${relCount}`);
    if (rel.label !== "supports") continue;
    if (!rel.source_labels?.includes("LearningComponent")) continue;
    if (!rel.target_labels?.includes("StandardsFrameworkItem")) continue;
    const sourceId = rel.source_identifier;
    const targetId = rel.target_identifier;
    if (!sourceId || !targetId || !components[sourceId]) continue;
    if (!supports[sourceId]) supports[sourceId] = [];
    supports[sourceId].push(targetId);
  }

  // Collapse duplicate standard keys into unique entries referenced by supports
  const uniqueStandards = {};
  for (const s of Object.values(standards)) {
    uniqueStandards[s.id] = s;
  }

  const byGrade = {};
  for (const [componentId, component] of Object.entries(components)) {
    const standardIds = supports[componentId] ?? [];
    const related = [];
    const seen = new Set();
    for (const sid of standardIds) {
      const std = standards[sid] || uniqueStandards[sid];
      if (!std || seen.has(std.id)) continue;
      seen.add(std.id);
      related.push(std);
    }
    if (related.length === 0) continue;

    for (const std of related) {
      for (const g of std.gradeLevel) {
        const key = String(g);
        if (!byGrade[key]) byGrade[key] = {};
        if (!byGrade[key][componentId]) {
          byGrade[key][componentId] = {
            id: component.id,
            description: component.description,
            relatedStandards: [],
          };
        }
        const existing = byGrade[key][componentId].relatedStandards;
        if (!existing.some((r) => r.id === std.id)) {
          existing.push({
            id: std.id,
            code: std.code,
            description: std.description,
            gradeLevel: std.gradeLevel,
            jurisdiction: std.jurisdiction || "Multi-State",
          });
        }
      }
    }
  }

  const gradeSummary = Object.fromEntries(
    Object.entries(byGrade).map(([g, comps]) => [g, Object.keys(comps).length]),
  );

  const payload = {
    builtAt: new Date().toISOString(),
    gradeSummary,
    byGrade: Object.fromEntries(
      Object.entries(byGrade).map(([g, comps]) => [g, Object.values(comps)]),
    ),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log(`Wrote ${outPath}`);
  console.log("Grade summary:", gradeSummary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
