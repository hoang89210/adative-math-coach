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
  diagnoseSuggestion,
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
import type { LearningComponent } from "./types";
import type { HeatmapStandardMeta } from "@/lib/lc-mastery";
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

function numericGrade(e: StandardIndexEntry | undefined): number | null {
  if (!e) return null;
  const g = parseStandardCode(e.code).grade ?? minGrade(e.gradeLevel);
  if (g === null) return /^HS/i.test(e.code ?? "") ? 9 : null;
  return g === "K" ? 0 : Number(g);
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
  return { state: s.state, mean: s.mean, n: s.n, grade: numericGrade(e) };
}

/**
 * The LC's own standards plus CCSS standards reached through
 * hasStandardAlignment from its state standards (marked `aligned`). Lets a
 * state-only LC get a CCSS primary standard for a Multi-State learner.
 */
export function lcStandardsWithAlignment(comp: LearningComponent): HeatmapStandardMeta[] {
  const prog = loadProgression();
  const idx = getStandardIndex();
  const own: HeatmapStandardMeta[] = comp.relatedStandards.map((s) => ({
    id: s.id,
    code: s.code,
    description: s.description,
    jurisdiction: s.jurisdiction,
    gradeLevel: s.gradeLevel,
  }));
  const seen = new Set(own.map((s) => s.id));
  const aligned: HeatmapStandardMeta[] = [];
  for (const s of comp.relatedStandards) {
    if ((s.jurisdiction || "Multi-State") === "Multi-State") continue;
    for (const cid of prog?.alignedToCcss?.[s.id] ?? []) {
      if (seen.has(cid)) continue;
      const e = idx.standards.get(cid);
      if (!e) continue;
      seen.add(cid);
      aligned.push({
        id: e.id,
        code: e.code,
        description: e.description,
        jurisdiction: e.jurisdiction,
        gradeLevel: e.gradeLevel,
        aligned: true,
      });
    }
  }
  return [...own, ...aligned];
}

export type RootGapReport = {
  /** review = "Ôn nền tảng: X trước khi tiếp Y"; diagnose = quick checks, no review */
  kind: "review" | "diagnose";
  target: { standardId: string; label: string; description: string; viaLcId?: string };
  /** review only */
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
  } | null;
  /** diagnose only: direct prerequisites without data */
  checkPrereqs: Array<{ standardId: string; label: string; source: PrereqSource }>;
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
 * "gap". Reviews (nearest first) come before diagnose items.
 */
export function analyzeRootGaps(params: {
  posteriors: Map<string, BetaParams>;
  jurisdiction?: string;
  grade?: string;
  maxReports?: number;
}): RootGapReport[] {
  const { posteriors, jurisdiction, grade } = params;
  const idx = getStandardIndex();
  const targets = new Map<string, string | undefined>();

  const touchedStandards = new Set<string>();
  for (const [lcId, p] of posteriors) {
    const comp = idx.components.get(lcId);
    if (!comp) continue;
    const primary = pickPrimaryStandard(lcStandardsWithAlignment(comp), jurisdiction, grade);
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

  const lcsOf = (sid: string) =>
    (idx.standards.get(sid)?.lcIds ?? [])
      .map((id) => idx.components.get(id))
      .filter(Boolean)
      .map((c) => ({ id: c!.id, description: c!.description }));

  const reports: RootGapReport[] = [];
  const seen = new Set<string>();
  for (const [sid, viaLcId] of targets) {
    const r = findRootGap({
      targetId: sid,
      getPrereqs: getPrereqEdges,
      statusOf: (id) => standardStatus(id, posteriors),
    });
    if (!r) continue;
    const targetEntry = idx.standards.get(sid);
    const targetLabel = standardLabel(sid);
    const target = {
      standardId: sid,
      label: targetLabel,
      description: targetEntry?.description ?? "",
      viaLcId,
    };

    if (r.kind === "review") {
      const key = `review:${r.rootId}->${sid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rootEntry = idx.standards.get(r.rootId);
      const rootLcs = lcsOf(r.rootId);
      const withData = rootLcs
        .filter((c) => posteriors.has(c.id))
        .map((c) => ({ c, mean: summarize(posteriors.get(c.id)!).mean }))
        .sort((a, b) => a.mean - b.mean);
      const rep = withData[0]?.c ?? rootLcs[0] ?? null;
      const rootLabel = standardLabel(r.rootId);
      reports.push({
        kind: "review",
        target,
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
        checkPrereqs: [],
        depth: r.depth,
        path: r.path.map((id) => ({ standardId: id, label: standardLabel(id) })),
        pathSources: r.pathSources,
        dataSource: r.dataSource,
        suggestion: foundationSuggestion(rootLabel, targetLabel),
        diagnostics: [],
      });
    } else {
      const key = `diagnose:${sid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const labels = r.prereqs.map((e) => standardLabel(e.id));
      // one LC per direct prerequisite first, then fill up to 3
      const perPrereq = r.prereqs.map((e) => lcsOf(e.id));
      const lcs: Array<{ id: string; description: string }> = [];
      for (let i = 0; lcs.length < 3 && i < 3; i++) {
        for (const list of perPrereq) {
          if (list[i] && lcs.length < 3) lcs.push(list[i]);
        }
      }
      reports.push({
        kind: "diagnose",
        target,
        root: null,
        checkPrereqs: r.prereqs.map((e) => ({
          standardId: e.id,
          label: standardLabel(e.id),
          source: e.source,
        })),
        depth: 1,
        path: [{ standardId: sid, label: targetLabel }],
        pathSources: [],
        dataSource: r.dataSource,
        suggestion: diagnoseSuggestion(labels, targetLabel),
        diagnostics: diagnosticProbes(labels.join(", "), lcs, 3),
      });
    }
  }

  reports.sort(
    (a, b) =>
      (a.kind === "review" ? 0 : 1) - (b.kind === "review" ? 0 : 1) ||
      a.depth - b.depth ||
      (a.root?.mean ?? 1) - (b.root?.mean ?? 1) ||
      a.target.label.localeCompare(b.target.label),
  );
  return reports.slice(0, params.maxReports ?? 3);
}
