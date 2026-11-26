/**
 * Root-gap tracing — pure graph logic, no I/O.
 *
 * Policy (lead decision after QA round 1, replaces "deepest non-mastered
 * within 3 levels"):
 *   - Walk prerequisites BACKWARDS breadth-first from a target standard that
 *     is in gap, up to `maxDepth` (3) levels.
 *   - Real Knowledge-Graph edges are preferred: the graph only offers a
 *     heuristic edge when a node has no real edge, and a path may contain at
 *     most `maxHeuristicHops` (1) heuristic hop.
 *   - Never visit a standard more than `maxGradeDrop` (2) grades below the
 *     target standard.
 *   - Pick the NEAREST prerequisite that HAS DATA and is in "gap"
 *     (ties: lower mean, then fewer heuristic hops, then id) -> "review"
 *     result ("Ôn nền tảng").
 *   - Only nodes with data that are not mastered are expanded further;
 *     no-data nodes are leaves (walking through unknowns proves nothing) and
 *     mastered nodes are trusted.
 *   - If no gap-with-data is found but some DIRECT prerequisites have no
 *     data -> "diagnose" result: quick checks for those direct
 *     prerequisites, and NO "ôn" suggestion.
 *   - Otherwise null.
 *
 * Each edge carries provenance so the UI / PR can say whether the result came
 * from real Knowledge Graph data or from the heuristic.
 */

import type { MasteryState } from "./lc-mastery";

export type PrereqSource =
  /** CCSS buildsTowards edge from the Learning Commons KG (real) */
  | "buildsTowards"
  /** state standard -> hasStandardAlignment -> CCSS -> buildsTowards (real) */
  | "alignment"
  /** same jurisdiction + domain, previous grade (HEURISTIC, not KG data) */
  | "heuristic";

export type PrereqEdge = { id: string; source: PrereqSource };

export type NodeStatus = {
  state: MasteryState;
  mean: number;
  n: number;
  /** numeric grade (K = 0, high school = 9), null when unknown */
  grade?: number | null;
};

export type RootGapInput = {
  targetId: string;
  getPrereqs: (id: string) => PrereqEdge[];
  statusOf: (id: string) => NodeStatus;
  maxDepth?: number;
  maxGradeDrop?: number;
  maxHeuristicHops?: number;
};

type Common = {
  targetId: string;
  /** "real" if every hop used is KG data; "heuristic" if any hop is heuristic */
  dataSource: "real" | "heuristic";
  visited: number;
};

export type RootGapReview = Common & {
  kind: "review";
  rootId: string;
  depth: number;
  /** target -> ... -> root */
  path: string[];
  /** provenance of each hop along `path` (length = path.length - 1) */
  pathSources: PrereqSource[];
  rootStatus: NodeStatus;
};

export type RootGapDiagnose = Common & {
  kind: "diagnose";
  /** direct prerequisites with no data yet (max 3, real edges first) */
  prereqs: PrereqEdge[];
};

export type RootGapResult = RootGapReview | RootGapDiagnose;

export const ROOT_GAP_MAX_DEPTH = 3;
export const ROOT_GAP_MAX_GRADE_DROP = 2;
export const ROOT_GAP_MAX_HEURISTIC_HOPS = 1;
const NO_DATA_EPS = 1e-9;

export function hasData(st: NodeStatus) {
  return st.n > NO_DATA_EPS;
}

const sourceRank = (s: PrereqSource) => (s === "heuristic" ? 1 : 0);

export function findRootGap(input: RootGapInput): RootGapResult | null {
  const maxDepth = Math.max(1, Math.min(input.maxDepth ?? ROOT_GAP_MAX_DEPTH, 6));
  const maxDrop = input.maxGradeDrop ?? ROOT_GAP_MAX_GRADE_DROP;
  const maxHeur = input.maxHeuristicHops ?? ROOT_GAP_MAX_HEURISTIC_HOPS;
  const statusOf = (id: string): NodeStatus =>
    input.statusOf(id) ?? { state: "insufficient", mean: 0.5, n: 0 };
  const targetStatus = statusOf(input.targetId);
  const floor =
    typeof targetStatus.grade === "number" ? targetStatus.grade - maxDrop : null;

  type Info = { depth: number; from: string; source: PrereqSource; heur: number; st: NodeStatus };
  const info = new Map<string, Info>();
  const seen = new Set<string>([input.targetId]);
  const heurAt = new Map<string, number>([[input.targetId, 0]]);
  let frontier: string[] = [input.targetId];
  const direct: PrereqEdge[] = [];

  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const level: string[] = [];
    for (const from of frontier) {
      const edges = [...input.getPrereqs(from)].sort(
        (a, b) => sourceRank(a.source) - sourceRank(b.source) || a.id.localeCompare(b.id),
      );
      for (const e of edges) {
        if (!e.id || seen.has(e.id)) continue;
        const heur = (heurAt.get(from) ?? 0) + (e.source === "heuristic" ? 1 : 0);
        if (heur > maxHeur) continue;
        const st = statusOf(e.id);
        if (floor !== null && typeof st.grade === "number" && st.grade < floor) continue;
        seen.add(e.id);
        heurAt.set(e.id, heur);
        info.set(e.id, { depth, from, source: e.source, heur, st });
        level.push(e.id);
        if (depth === 1) direct.push(e);
      }
    }

    const gaps = level
      .filter((id) => {
        const st = info.get(id)!.st;
        return st.state === "gap" && hasData(st);
      })
      .sort(
        (a, b) =>
          info.get(a)!.st.mean - info.get(b)!.st.mean ||
          info.get(a)!.heur - info.get(b)!.heur ||
          a.localeCompare(b),
      );
    if (gaps.length) {
      const rootId = gaps[0];
      const path = [rootId];
      const sources: PrereqSource[] = [];
      let cur = rootId;
      while (cur !== input.targetId) {
        const i = info.get(cur)!;
        sources.unshift(i.source);
        path.unshift(i.from);
        cur = i.from;
      }
      return {
        kind: "review",
        targetId: input.targetId,
        rootId,
        depth,
        path,
        pathSources: sources,
        dataSource: sources.includes("heuristic") ? "heuristic" : "real",
        rootStatus: info.get(rootId)!.st,
        visited: seen.size,
      };
    }
    // expand only nodes with data that are not mastered
    frontier = level.filter((id) => {
      const st = info.get(id)!.st;
      return hasData(st) && st.state !== "mastered";
    });
  }

  const noData = direct
    .filter((e) => !hasData(info.get(e.id)!.st))
    .sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || a.id.localeCompare(b.id))
    .slice(0, 3);
  if (noData.length) {
    return {
      kind: "diagnose",
      targetId: input.targetId,
      prereqs: noData,
      dataSource: noData.some((e) => e.source === "heuristic") ? "heuristic" : "real",
      visited: seen.size,
    };
  }
  return null;
}

export function foundationSuggestion(rootLabel: string, targetLabel: string) {
  return `Ôn nền tảng: ${rootLabel} trước khi tiếp ${targetLabel}`;
}

/** Used when prerequisites have no data yet: check first, do not prescribe review. */
export function diagnoseSuggestion(prereqLabels: string[], targetLabel: string) {
  return `Kiểm tra nhanh nền tảng: ${prereqLabels.join(", ")} trước khi tiếp ${targetLabel}`;
}

export type DiagnosticProbe = {
  lcId: string;
  skill: string;
  prompt: string;
  kind: "template";
};

/**
 * 2–3 quick diagnostic prompts for a prerequisite with no data. There is no
 * stored item bank (diagnostic items are generated per session), so these
 * are deterministic templates built from the LC descriptions — no LLM call.
 */
export function diagnosticProbes(
  standardLabel: string,
  lcs: Array<{ id: string; description: string }>,
  max = 3,
): DiagnosticProbe[] {
  const templates = [
    (s: string) => `Quick check — ${s}: solve one short problem on this and show each step.`,
    (s: string) => `Quick check — ${s}: explain in one or two sentences how you would start, then give the answer.`,
    (s: string) => `Quick check — ${s}: spot the mistake in a worked example and fix it.`,
  ];
  const picked = lcs.filter((l) => l.description).slice(0, Math.max(2, Math.min(max, 3)));
  const list =
    picked.length > 0
      ? picked
      : [{ id: `std:${standardLabel}`, description: standardLabel }];
  const out: DiagnosticProbe[] = [];
  for (let i = 0; i < Math.min(3, Math.max(2, list.length)); i++) {
    const lc = list[i % list.length];
    out.push({
      lcId: lc.id,
      skill: lc.description,
      prompt: templates[i % templates.length](lc.description),
      kind: "template",
    });
  }
  return out;
}

/** Domain + cluster from a standard code, e.g. "4.NF.A.1" -> {grade:"4", domain:"NF", cluster:"A"}. */
export function parseStandardCode(code: string | null | undefined): {
  grade: string | null;
  domain: string | null;
  cluster: string | null;
} {
  const c = String(code ?? "").trim();
  const m = c.match(/^(K|\d{1,2})\.([A-Za-z]+)(?:\.([A-Za-z])(?=\.|$))?/);
  if (m) {
    return {
      grade: m[1].toUpperCase() === "K" ? "K" : String(Number(m[1])),
      domain: m[2].toUpperCase(),
      cluster: m[3] ? m[3].toUpperCase() : null,
    };
  }
  const hs = c.match(/^HS([A-Z])-([A-Z]+)(?:\.([A-Z]))?/i);
  if (hs) {
    return {
      grade: null,
      domain: `HS${hs[1]}-${hs[2]}`.toUpperCase(),
      cluster: hs[3] ? hs[3].toUpperCase() : null,
    };
  }
  const d = c.match(/\.([A-Z]{2,4})(?:\.|$)/i);
  return { grade: null, domain: d ? d[1].toUpperCase() : null, cluster: null };
}

export function previousGrade(grade: string): string | null {
  if (grade === "K") return null;
  const n = Number(grade);
  if (!Number.isFinite(n)) return null;
  if (n <= 1) return "K";
  return String(n - 1);
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

export type HeuristicCandidate = {
  id: string;
  code: string | null;
  description: string;
  grade: string;
  domain: string | null;
  cluster: string | null;
  jurisdiction: string;
};

/**
 * HEURISTIC prerequisites (used only when the KG has no buildsTowards /
 * alignment path for a standard): standards in the SAME jurisdiction and
 * SAME domain one grade lower. Ranked by same cluster letter, then word
 * overlap with the target description. Labelled "heuristic" everywhere.
 */
export function heuristicPrereqs(
  target: HeuristicCandidate,
  pool: HeuristicCandidate[],
  limit = 3,
): PrereqEdge[] {
  if (!target.domain) return [];
  const prev = previousGrade(target.grade);
  if (!prev) return [];
  const tt = tokens(target.description);
  return pool
    .filter(
      (c) =>
        c.id !== target.id &&
        c.grade === prev &&
        c.domain === target.domain &&
        c.jurisdiction === target.jurisdiction,
    )
    .map((c) => {
      const ct = tokens(c.description);
      let overlap = 0;
      for (const w of ct) if (tt.has(w)) overlap += 1;
      const score = (c.cluster && c.cluster === target.cluster ? 1 : 0) + overlap / Math.max(1, Math.sqrt(ct.size * tt.size));
      return { c, score };
    })
    .sort((a, b) => b.score - a.score || (a.c.code ?? "").localeCompare(b.c.code ?? "", undefined, { numeric: true }))
    .slice(0, limit)
    .map(({ c }) => ({ id: c.id, source: "heuristic" as const }));
}
