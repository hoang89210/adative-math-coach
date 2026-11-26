/**
 * Root-gap tracing — pure graph logic, no I/O.
 *
 * Given a target standard that is in "gap" (or contains an LC in gap), walk
 * the prerequisite graph BACKWARDS breadth-first up to `maxDepth` levels and
 * pick the deepest prerequisite that is not mastered as the "root gap".
 *
 * Rules:
 *   - Mastered prerequisites are not expanded: if the learner owns a
 *     prerequisite we trust its own foundations (prunes noise).
 *   - Candidates = visited nodes at depth >= 1 whose state != "mastered".
 *   - Root = max depth; ties -> gap > learning > insufficient, then lower
 *     mean, then id (deterministic).
 *   - If the root has no data ("insufficient"), callers should propose quick
 *     diagnostic items for it (see `diagnosticProbes`).
 *
 * Each edge carries its provenance so the UI / PR can say whether the
 * suggestion came from real Knowledge Graph data or from the heuristic.
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
};

export type RootGapInput = {
  targetId: string;
  getPrereqs: (id: string) => PrereqEdge[];
  statusOf: (id: string) => NodeStatus;
  maxDepth?: number;
};

export type RootGapResult = {
  targetId: string;
  rootId: string;
  depth: number;
  /** target -> ... -> root */
  path: string[];
  /** provenance of each hop along `path` (length = path.length - 1) */
  pathSources: PrereqSource[];
  /** "real" if every hop is KG data; "heuristic" if any hop is heuristic */
  dataSource: "real" | "heuristic";
  rootStatus: NodeStatus;
  needsDiagnostic: boolean;
  visited: number;
};

export const ROOT_GAP_MAX_DEPTH = 3;

const STATE_RANK: Record<MasteryState, number> = {
  gap: 0,
  learning: 1,
  insufficient: 2,
  mastered: 3,
};

export function findRootGap(input: RootGapInput): RootGapResult | null {
  const maxDepth = Math.max(1, Math.min(input.maxDepth ?? ROOT_GAP_MAX_DEPTH, 6));
  const parent = new Map<string, { from: string; source: PrereqSource }>();
  const depth = new Map<string, number>([[input.targetId, 0]]);
  const status = new Map<string, NodeStatus>();
  const queue: string[] = [input.targetId];

  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    if (d >= maxDepth) continue;
    if (d > 0) {
      const st = status.get(id)!;
      if (st.state === "mastered") continue; // prune
    }
    const edges = [...input.getPrereqs(id)].sort((a, b) => a.id.localeCompare(b.id));
    for (const e of edges) {
      if (!e.id || depth.has(e.id)) continue;
      depth.set(e.id, d + 1);
      parent.set(e.id, { from: id, source: e.source });
      status.set(e.id, input.statusOf(e.id));
      queue.push(e.id);
    }
  }

  let best: string | null = null;
  for (const [id, d] of depth) {
    if (d === 0) continue;
    const st = status.get(id)!;
    if (st.state === "mastered") continue;
    if (best === null) {
      best = id;
      continue;
    }
    const bd = depth.get(best)!;
    const bs = status.get(best)!;
    const better =
      d > bd ||
      (d === bd &&
        (STATE_RANK[st.state] < STATE_RANK[bs.state] ||
          (STATE_RANK[st.state] === STATE_RANK[bs.state] &&
            (st.mean < bs.mean || (st.mean === bs.mean && id < best)))));
    if (better) best = id;
  }
  if (!best) return null;

  const path: string[] = [best];
  const sources: PrereqSource[] = [];
  let cur = best;
  while (cur !== input.targetId) {
    const p = parent.get(cur)!;
    sources.unshift(p.source);
    path.unshift(p.from);
    cur = p.from;
  }
  const rootStatus = status.get(best)!;
  return {
    targetId: input.targetId,
    rootId: best,
    depth: depth.get(best)!,
    path,
    pathSources: sources,
    dataSource: sources.includes("heuristic") ? "heuristic" : "real",
    rootStatus,
    needsDiagnostic: rootStatus.state === "insufficient",
    visited: depth.size,
  };
}

export function foundationSuggestion(rootLabel: string, targetLabel: string) {
  return `Ôn nền tảng: ${rootLabel} trước khi tiếp ${targetLabel}`;
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
