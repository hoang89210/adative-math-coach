import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const indexPath = path.join(root, "data", "math-index.json");
const outPath = path.join(root, "data", "standards-catalog.json");

const DOMAIN_LABELS = {
  CC: "Counting & cardinality",
  OA: "Operations & algebraic thinking",
  NBT: "Number & place value",
  NF: "Fractions",
  MD: "Measurement & data",
  G: "Geometry",
  NS: "Number system",
  RP: "Ratios & proportions",
  EE: "Expressions & equations",
  F: "Functions",
  SP: "Statistics & probability",
  GM: "Geometry (extended)",
  CE: "Computation & estimation",
  MG: "Measurement & geometry",
  PS: "Problem solving",
  MGSR: "Measurement / geometry / spatial",
  MP: "Math practices",
  Other: "Other",
};

function domainFromCode(code) {
  if (!code) return "Other";
  const c = String(code).trim();
  const m =
    c.match(/^(?:K|[0-9]{1,2})\.([A-Za-z]+)/) ||
    c.match(/\.([A-Z]{1,4})(?:\.|$)/i);
  if (m) return m[1].toUpperCase();
  return "Other";
}

function domainLabel(id) {
  return DOMAIN_LABELS[id] || id;
}

function main() {
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  /** grade -> domain -> Map<code, {code, description, ids}> */
  const byGrade = {};

  for (const [grade, components] of Object.entries(index.byGrade || {})) {
    if (!byGrade[grade]) byGrade[grade] = {};
    for (const comp of components) {
      for (const s of comp.relatedStandards || []) {
        const code = s.code;
        if (!code) continue;
        const domain = domainFromCode(code);
        if (!byGrade[grade][domain]) byGrade[grade][domain] = new Map();
        const map = byGrade[grade][domain];
        const existing = map.get(code);
        if (existing) {
          if (!existing.componentIds.includes(comp.id)) {
            existing.componentIds.push(comp.id);
          }
        } else {
          map.set(code, {
            code,
            description: s.description || "",
            standardId: s.id,
            componentIds: [comp.id],
          });
        }
      }
    }
  }

  const grades = {};
  for (const [grade, domains] of Object.entries(byGrade)) {
    const domainList = Object.entries(domains)
      .map(([domainId, map]) => {
        const standards = [...map.values()].sort((a, b) =>
          a.code.localeCompare(b.code, undefined, { numeric: true }),
        );
        return {
          id: domainId,
          label: domainLabel(domainId),
          count: standards.length,
          standards: standards.map((s) => ({
            code: s.code,
            description: s.description.slice(0, 240),
            standardId: s.standardId,
            componentCount: s.componentIds.length,
          })),
        };
      })
      .sort((a, b) => b.count - a.count);

    grades[grade] = {
      domains: domainList,
      standardCount: domainList.reduce((n, d) => n + d.count, 0),
    };
  }

  const gradeOrder = [
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
  ];

  const journey = gradeOrder.map((g) => {
    const entry = grades[g];
    const topDomains = (entry?.domains || [])
      .filter((d) => d.id !== "Other")
      .slice(0, 6)
      .map((d) => ({ id: d.id, label: d.label, count: d.count }));
    return {
      grade: g,
      standardCount: entry?.standardCount ?? 0,
      domains: topDomains,
    };
  });

  const payload = {
    builtAt: new Date().toISOString(),
    domainLabels: DOMAIN_LABELS,
    grades,
    journey,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log(
    `Wrote ${outPath} grades=${Object.keys(grades).length} journey=${journey.length}`,
  );
}

main();
