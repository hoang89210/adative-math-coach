import type { LearningComponent } from "@/lib/data/types";
import type { GradeResult } from "@/lib/types/quiz";

export type CoverageReport = {
  grade: string;
  jurisdiction?: string;
  overallPct: number;
  standardsTouched: Array<{
    code: string;
    jurisdiction?: string;
    lcTotal: number;
    lcHit: number;
    lcMiss: number;
    pct: number;
  }>;
  domainCoverage: Array<{
    domain: string;
    pct: number;
    hit: number;
    total: number;
  }>;
  holes: Array<{ label: string; detail: string }>;
};

function domainFromCode(code: string | null | undefined) {
  if (!code) return "Other";
  const m =
    code.match(/^(?:K|[0-9]{1,2})\.([A-Za-z]+)/) ||
    code.match(/\.([A-Z]{1,4})(?:\.|$)/i);
  return m ? m[1].toUpperCase() : "Other";
}

export function computeCoverage(params: {
  grade: string;
  jurisdiction?: string;
  result: GradeResult;
  componentsMeta: LearningComponent[];
}): CoverageReport {
  const metaById = new Map(params.componentsMeta.map((c) => [c.id, c]));
  const byStandard = new Map<
    string,
    {
      code: string;
      jurisdiction?: string;
      hit: number;
      total: number;
    }
  >();
  const byDomain = new Map<string, { hit: number; total: number }>();

  for (const row of params.result.byComponent) {
    const meta = metaById.get(row.componentId);
    const standards =
      meta?.relatedStandards?.length && meta.relatedStandards.length > 0
        ? meta.relatedStandards
        : [
            {
              id: row.componentId,
              code: null as string | null,
              description: row.description,
              gradeLevel: [] as string[],
              jurisdiction: undefined as string | undefined,
            },
          ];

    for (const s of standards.slice(0, 3)) {
      const code = s.code || "skill";
      const key = `${s.jurisdiction || ""}::${code}::${row.componentId}`;
      if (!byStandard.has(key)) {
        byStandard.set(key, {
          code,
          jurisdiction: s.jurisdiction,
          hit: 0,
          total: 0,
        });
      }
      const st = byStandard.get(key)!;
      st.total += 1;
      if (row.mastered) st.hit += 1;

      const dom = domainFromCode(s.code);
      if (!byDomain.has(dom)) byDomain.set(dom, { hit: 0, total: 0 });
      const d = byDomain.get(dom)!;
      d.total += 1;
      if (row.mastered) d.hit += 1;
    }
  }

  // collapse by code
  const collapsed = new Map<
    string,
    {
      code: string;
      jurisdiction?: string;
      hit: number;
      total: number;
    }
  >();
  for (const s of byStandard.values()) {
    const k = `${s.jurisdiction || ""}::${s.code}`;
    const cur = collapsed.get(k) || {
      code: s.code,
      jurisdiction: s.jurisdiction,
      hit: 0,
      total: 0,
    };
    cur.hit += s.hit;
    cur.total += s.total;
    collapsed.set(k, cur);
  }

  const standardsTouched = [...collapsed.values()]
    .map((s) => ({
      code: s.code,
      jurisdiction: s.jurisdiction,
      lcTotal: s.total,
      lcHit: s.hit,
      lcMiss: s.total - s.hit,
      pct: s.total ? Math.round((s.hit / s.total) * 100) : 0,
    }))
    .sort((a, b) => a.pct - b.pct);

  const domainCoverage = [...byDomain.entries()]
    .map(([domain, v]) => ({
      domain,
      hit: v.hit,
      total: v.total,
      pct: v.total ? Math.round((v.hit / v.total) * 100) : 0,
    }))
    .sort((a, b) => a.pct - b.pct);

  const totalHit = params.result.byComponent.filter((c) => c.mastered).length;
  const total = params.result.byComponent.length || 1;

  const holes = params.result.weakComponents.slice(0, 8).map((w) => ({
    label: w.description,
    detail: `${w.correct}/${w.total} correct on diagnostic`,
  }));

  return {
    grade: params.grade,
    jurisdiction: params.jurisdiction,
    overallPct: Math.round((totalHit / total) * 100),
    standardsTouched: standardsTouched.slice(0, 20),
    domainCoverage,
    holes,
  };
}
