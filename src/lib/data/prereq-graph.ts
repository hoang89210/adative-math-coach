import {
  type BetaParams,
  pickPrimaryStandard,
  poolPosteriors,
  summarize,
} from "@/lib/lc-mastery";
import {
  type DiagnosticProbe,
  type HeuristicCandidate,
  type NodeStatus,
  type PrereqEdge,
  type PrereqSource,
  diagnosticProbes,
  findRootGap,
  foundationSuggestion,
  heuristicPrereqs,
  parseStandardCode,
} from "@/lib/root-gap";
import {
  type StandardIndexEntry,
  getStandardIndex,
} from "./learning-components";
import { loadProgression } from "./progression";

/**
 * Server-side prerequisite graph over math-index standards.
 *
 * Order of sources for "prerequisites of standard S":
 *   1. CCSS `buildsTowards` edges (real KG data, Student Achievement Partners)
 *   2. S --hasStandardAlignment--> CCSS C, then prerequisites of C (real KG)
 *   3. HEURISTIC: same jurisdiction + domain, one grade lower
 */

function minGrade(levels: string[]): string | null {
  let best: number | null = null;
  for (const g of levels) {
    const n = /^k$/i.test(g) ? 0 : Number(g);
    if (!Number.isFinite(n)) continue;
    if (best === null || n < best) best = n;
  }
  if (best === null) return null;
  return best === 0 ? "K" : String(best);
}

function toCandidate(e: StandardIndexEntry): HeuristicCandidate | null {
  const parsed = parseStandardCode(e.code);
  const grade = parsed.grade ?? minGrade(e.gradeLevel);
  if (!grade) return null;
  return {
    id: e.id,
    code: e.code,
    description: e.description,
    grade,
    domain: parsed.domain,
    cluster: parsed.cluster,
    jurisdiction: e.jurisdiction,
  };
}

let heuristicBuckets: Map<string, HeuristicCandidate[]> | null = null;

function bucketKey(jur: string, domain: string, grade: string) {
  return `${jur}|${domain}|${grade}`;
}

function getHeuristicBuckets() {
  if (heuristicBuckets) return heuristicBuckets;
  const m = new Map<string, HeuristicCandidate[]>();
  for (const e of getStandardIndex().standards.values()) {
    const c = toCandidate(e);
    if (!c?.domain || !c.code) continue;
    const k = bucketKey(c.jurisdiction, c.domain, c.grade);
    const list = m.get(k) ?? [];
    list.push(c);
    m.set(k, list);
  }
  heuristicBuckets = m;
  return m;
}

export function getPrereqEdges(standardId: string): PrereqEdge[] {
  const prog = loadProgression();
  const direct = prog?.prerequisitesOf?.[standardId];
  if (direct?.length) {
    return direct.map((id) => ({ id, source: "buildsTowards" as const }));
  }
  const aligned = prog?.alignedToCcss?.[standardId];
  if (aligned?.length) {
    const out = new Map<string, PrereqEdge>();
    for (const c of aligned) {
      for (const id of prog?.prerequisitesOf?.[c] ?? []) {
        if (id !== standardId) out.set(id, { id, source: "alignment" });
      }
    }
    if (out.size) return [...out.values()];
  }
  const entry = getStandardIndex().standards.get(standardId);
  if (!entry) return [];
  const target = toCandidate(entry);
  if (!target?.domain) return [];
  const prevKey = (() => {
    const g = target.grade;
    if (g === "K") return null;
    const n = Number(g);
    const prev = n <= 1 ? "K" : String(n - 1);
    return bucketKey(target.jurisdiction, target.domain, prev);
  })();
  if (!prevKey) return [];
  const pool = getHeuristicBuckets().get(prevKey) ?? [];
  return heuristicPrereqs(target, pool, 3);
}

export function standardLabel(id: string): string {
  const e = getStandardIndex().standards.get(id);
  if (!e) return id;
  if (e.code) return e.code;
  return e.description.length > 70 ? `${e.description.slice(0, 67)}…` : e.description;
}

export function standardStatus(
  id: string,
  posteriors: Map<string, BetaParams>,
): NodeStatus {
  const e = getStandardIndex().standards.get(id);
  const parts: BetaParams[] = [];
  for (const lc of e?.lcIds ?? []) {
    const p = posteriors.get(lc);
    if (p) parts.push(p);
  }
  const s = summarize(poolPosteriors(parts));
  return { state: s.state, mean: s.mean, n: s.n };
}

export type RootGapReport = {
  target: { standardId: string; label: string; description: string; viaLcId?: string };
  root: {
    standardId: string;
    label: string;
    description: string;
    state: NodeStatus["state"];
    mean: number;
    n: number;
    /** representative LC used for roadmap / study tools */
    lcId: string | null;
    lcDescription: string | null;
  };
  depth: number;
  path: Array<{ standardId: string; label: string }>;
  pathSources: PrereqSource[];
  dataSource: "real" | "heuristic";
  suggestion: string;
  diagnostics: DiagnosticProbe[];
};

/**
 * Find root gaps for a learner's posteriors. Targets are (a) the primary
 * standard of every LC in "gap" and (b) any standard whose pooled state is
 * "gap". Returns at most `maxReports`, deepest first.
 */
export function analyzeRootGaps(params: {
  posteriors: Map<string, BetaParams>;
  jurisdiction?: string;
  maxReports?: number;
}): RootGapReport[] {
  const { posteriors, jurisdiction } = params;
  const idx = getStandardIndex();
  const targets = new Map<string, string | undefined>();

  const touchedStandards = new Set<string>();
  for (const [lcId, p] of posteriors) {
    const comp = idx.components.get(lcId);
    if (!comp) continue;
    const primary = pickPrimaryStandard(
      comp.relatedStandards.map((s) => ({ ...s, jurisdiction: s.jurisdiction })),
      jurisdiction,
    );
    if (!primary) continue;
    touchedStandards.add(primary.id);
    if (summarize(p).state === "gap" && !targets.has(primary.id)) {
      targets.set(primary.id, lcId);
    }
  }
  for (const sid of touchedStandards) {
    if (targets.has(sid)) continue;
    if (standardStatus(sid, posteriors).state === "gap") targets.set(sid, undefined);
  }

  const reports: RootGapReport[] = [];
  const seenRoots = new Set<string>();
  for (const [sid, viaLcId] of targets) {
    const r = findRootGap({
      targetId: sid,
      getPrereqs: getPrereqEdges,
      statusOf: (id) => standardStatus(id, posteriors),
    });
    if (!r) continue;
    const key = `${r.rootId}->${sid}`;
    if (seenRoots.has(key)) continue;
    seenRoots.add(key);

    const rootEntry = idx.standards.get(r.rootId);
    const targetEntry = idx.standards.get(sid);
    const rootLcs = (rootEntry?.lcIds ?? [])
      .map((id) => idx.components.get(id))
      .filter(Boolean)
      .map((c) => ({ id: c!.id, description: c!.description }));
    // representative LC: lowest-mean LC with data, else first without data
    const withData = rootLcs
      .filter((c) => posteriors.has(c.id))
      .map((c) => ({ c, mean: summarize(posteriors.get(c.id)!).mean }))
      .sort((a, b) => a.mean - b.mean);
    const rep = withData.find((x) => x.mean < 0.8)?.c ?? rootLcs.find((c) => !posteriors.has(c.id)) ?? rootLcs[0] ?? null;
    const noData = rootLcs.filter((c) => !posteriors.has(c.id));

    const rootLabel = standardLabel(r.rootId);
    const targetLabel = standardLabel(sid);
    reports.push({
      target: {
        standardId: sid,
        label: targetLabel,
        description: targetEntry?.description ?? "",
        viaLcId,
      },
      root: {
        standardId: r.rootId,
        label: rootLabel,
        description: rootEntry?.description ?? "",
        state: r.rootStatus.state,
        mean: r.rootStatus.mean,
        n: r.rootStatus.n,
        lcId: rep?.id ?? null,
        lcDescription: rep?.description ?? null,
      },
      depth: r.depth,
      path: r.path.map((id) => ({ standardId: id, label: standardLabel(id) })),
      pathSources: r.pathSources,
      dataSource: r.dataSource,
      suggestion: foundationSuggestion(rootLabel, targetLabel),
      diagnostics: r.needsDiagnostic
        ? diagnosticProbes(rootLabel, noData.length ? noData : rootLcs, 3)
        : [],
    });
  }

  const rank = { gap: 0, learning: 1, insufficient: 2, mastered: 3 } as const;
  reports.sort(
    (a, b) =>
      b.depth - a.depth ||
      rank[a.root.state] - rank[b.root.state] ||
      a.root.mean - b.root.mean ||
      a.target.label.localeCompare(b.target.label),
  );
  return reports.slice(0, params.maxReports ?? 3);
}
