import fs from "fs";
import path from "path";

export type CatalogStandard = {
  code: string;
  description: string;
  standardId: string;
  componentCount: number;
  jurisdiction?: string;
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
  jurisdictions?: string[];
  grades: Record<
    string,
    {
      domains: CatalogDomain[];
      standardCount: number;
      jurisdictions?: Record<
        string,
        { domains: CatalogDomain[]; standardCount: number }
      >;
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

export function listJurisdictions(): string[] {
  const cat = loadStandardsCatalog();
  if (cat.jurisdictions?.length) return cat.jurisdictions;
  return ["Multi-State"];
}

function domainsFor(gradeKey: string, jurisdiction?: string): CatalogDomain[] {
  const cat = loadStandardsCatalog();
  const gradeEntry = cat.grades[gradeKey];
  if (!gradeEntry) return [];

  const jur = jurisdiction?.trim();
  if (jur && jur !== "All" && gradeEntry.jurisdictions?.[jur]) {
    return gradeEntry.jurisdictions[jur].domains;
  }
  // Multi-State preferred slice if present, else flat union
  if (
    (!jur || jur === "Multi-State") &&
    gradeEntry.jurisdictions?.["Multi-State"]
  ) {
    return gradeEntry.jurisdictions["Multi-State"].domains;
  }
  return gradeEntry.domains ?? [];
}

export function getDomainsForGrade(grade: string, jurisdiction?: string) {
  const key = normalizeGradeKey(grade);
  if (!key) return [];
  return domainsFor(key, jurisdiction).map((d) => ({
    id: d.id,
    label: d.label,
    count: d.count,
  }));
}

export function listStandards(params: {
  grade: string;
  domain?: string;
  jurisdiction?: string;
  q?: string;
  limit?: number;
}) {
  const key = normalizeGradeKey(params.grade);
  if (!key) return [];

  let standards: CatalogStandard[] = [];
  for (const d of domainsFor(key, params.jurisdiction)) {
    if (params.domain && d.id !== params.domain) continue;
    standards.push(...d.standards);
  }

  const q = (params.q ?? "").trim().toLowerCase();
  if (q) {
    standards = standards.filter(
      (s) =>
        s.code.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.jurisdiction || "").toLowerCase().includes(q),
    );
  }

  const limit = params.limit ?? 80;
  return standards.slice(0, limit);
}

export function getJourneyTimeline() {
  return loadStandardsCatalog().journey;
}
