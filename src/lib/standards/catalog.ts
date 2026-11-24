import fs from "fs";
import path from "path";

export type CatalogStandard = {
  code: string;
  description: string;
  standardId: string;
  componentCount: number;
};

export type CatalogDomain = {
  id: string;
  label: string;
  count: number;
  standards: CatalogStandard[];
};

export type StandardsCatalog = {
  builtAt: string;
  domainLabels: Record<string, string>;
  grades: Record<
    string,
    {
      domains: CatalogDomain[];
      standardCount: number;
    }
  >;
  journey: Array<{
    grade: string;
    standardCount: number;
    domains: Array<{ id: string; label: string; count: number }>;
  }>;
};

let cached: StandardsCatalog | null = null;

export function loadStandardsCatalog(): StandardsCatalog {
  if (cached) return cached;
  const p = path.join(process.cwd(), "data", "standards-catalog.json");
  if (!fs.existsSync(p)) {
    throw new Error(
      `Missing standards catalog at ${p}. Run: node scripts/build-standards-catalog.mjs`,
    );
  }
  cached = JSON.parse(fs.readFileSync(p, "utf8")) as StandardsCatalog;
  return cached;
}

export function normalizeGradeKey(grade: string): string | null {
  const g = String(grade).trim();
  if (!g) return null;
  if (/^k$/i.test(g)) return "K";
  if (/^\d{1,2}$/.test(g)) return String(Number(g));
  return null;
}

export function getDomainsForGrade(grade: string) {
  const key = normalizeGradeKey(grade);
  if (!key) return [];
  const cat = loadStandardsCatalog();
  return (cat.grades[key]?.domains ?? []).map((d) => ({
    id: d.id,
    label: d.label,
    count: d.count,
  }));
}

export function listStandards(params: {
  grade: string;
  domain?: string;
  q?: string;
  limit?: number;
}) {
  const key = normalizeGradeKey(params.grade);
  if (!key) return [];
  const cat = loadStandardsCatalog();
  const gradeEntry = cat.grades[key];
  if (!gradeEntry) return [];

  let standards: CatalogStandard[] = [];
  for (const d of gradeEntry.domains) {
    if (params.domain && d.id !== params.domain) continue;
    standards.push(...d.standards);
  }

  const q = (params.q ?? "").trim().toLowerCase();
  if (q) {
    standards = standards.filter(
      (s) =>
        s.code.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }

  const limit = params.limit ?? 80;
  return standards.slice(0, limit);
}

export function getJourneyTimeline() {
  return loadStandardsCatalog().journey;
}
