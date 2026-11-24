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
  /** grade -> jurisdiction -> domain -> Map<code, std> */
  const tree = {};
  const jurisdictionSet = new Set();

  for (const [grade, components] of Object.entries(index.byGrade || {})) {
    if (!tree[grade]) tree[grade] = {};
    for (const comp of components) {
      for (const s of comp.relatedStandards || []) {
        const code = s.code;
        if (!code) continue;
        const jur = s.jurisdiction || "Multi-State";
        jurisdictionSet.add(jur);
        const domain = domainFromCode(code);
        if (!tree[grade][jur]) tree[grade][jur] = {};
        if (!tree[grade][jur][domain]) tree[grade][jur][domain] = new Map();
        const map = tree[grade][jur][domain];
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
            jurisdiction: jur,
            componentIds: [comp.id],
          });
        }
      }
    }
  }

  const grades = {};
  for (const [grade, byJur] of Object.entries(tree)) {
    const jurisdictions = {};
    for (const [jur, domains] of Object.entries(byJur)) {
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
              jurisdiction: s.jurisdiction,
              componentCount: s.componentIds.length,
            })),
          };
        })
        .sort((a, b) => b.count - a.count);

      jurisdictions[jur] = {
        domains: domainList,
        standardCount: domainList.reduce((n, d) => n + d.count, 0),
      };
    }
    grades[grade] = { jurisdictions };
  }

  // Backward-compatible flattened grades (union all jurisdictions)
  const gradesFlat = {};
  for (const [grade, payload] of Object.entries(grades)) {
    const domainMaps = {};
    for (const jurPayload of Object.values(payload.jurisdictions)) {
      for (const d of jurPayload.domains) {
        if (!domainMaps[d.id]) {
          domainMaps[d.id] = {
            id: d.id,
            label: d.label,
            standards: new Map(),
          };
        }
        for (const s of d.standards) {
          const key = `${s.jurisdiction}::${s.code}`;
          if (!domainMaps[d.id].standards.has(key)) {
            domainMaps[d.id].standards.set(key, s);
          }
        }
      }
    }
    const domains = Object.values(domainMaps)
      .map((d) => {
        const standards = [...d.standards.values()].sort((a, b) =>
          a.code.localeCompare(b.code, undefined, { numeric: true }),
        );
        return {
          id: d.id,
          label: d.label,
          count: standards.length,
          standards,
        };
      })
      .sort((a, b) => b.count - a.count);
    gradesFlat[grade] = {
      domains,
      standardCount: domains.reduce((n, d) => n + d.count, 0),
      jurisdictions: payload.jurisdictions,
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
    const entry = gradesFlat[g];
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

  const jurisdictions = [...jurisdictionSet].sort((a, b) => {
    if (a === "Multi-State") return -1;
    if (b === "Multi-State") return 1;
    return a.localeCompare(b);
  });

  const payload = {
    builtAt: new Date().toISOString(),
    domainLabels: DOMAIN_LABELS,
    jurisdictions,
    grades: gradesFlat,
    journey,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log(
    `Wrote ${outPath} jurisdictions=${jurisdictions.length} grades=${Object.keys(gradesFlat).length}`,
  );
}

main();
