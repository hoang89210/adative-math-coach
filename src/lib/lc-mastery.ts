/**
 * Learning-component (LC) mastery — pure Beta-Binomial statistics.
 *
 * Every (learner, LC) pair carries a Beta(alpha, beta) posterior over the
 * probability that the learner answers an item on that LC correctly.
 *
 *   prior        Beta(1, 1)                (uniform)
 *   correct      alpha += w
 *   wrong        beta  += w
 *   w            1 / k when one item is tagged with k LCs (so an item is
 *                worth one unit of evidence in total, not k units)
 *   mastery      mean = alpha / (alpha + beta)
 *   evidence     n = alpha + beta - 2      (weighted #items seen)
 *   confidence   lower80 = 20% quantile of Beta(alpha, beta)
 *                (we are 80% sure true mastery is at least this)
 *
 * States (thresholds are exported so UI/tests stay in sync):
 *   mastered      mean >= 0.8 && n >= 3
 *   gap           mean <  0.5 && n >= 2
 *   insufficient  n < 2   (and not one of the above)
 *   learning      everything else
 *
 * This module is our own statistics only: it never calls Learning Commons
 * evaluators or an LLM to grade a learner. No I/O here.
 */

export type BetaParams = { alpha: number; beta: number };

export type MasteryState = "mastered" | "gap" | "learning" | "insufficient";

export const PRIOR: Readonly<BetaParams> = Object.freeze({ alpha: 1, beta: 1 });
export const MASTERED_MIN_MEAN = 0.8;
export const MASTERED_MIN_N = 3;
export const GAP_MAX_MEAN = 0.5;
export const GAP_MIN_N = 2;
export const INSUFFICIENT_BELOW_N = 2;
export const LOWER_BOUND_Q = 0.2;

const EPS = 1e-9;

export function prior(): BetaParams {
  return { alpha: PRIOR.alpha, beta: PRIOR.beta };
}

/** Returns a new posterior after one (possibly fractional) observation. */
export function updateBeta(
  p: BetaParams,
  correct: boolean,
  weight = 1,
): BetaParams {
  const w = Number.isFinite(weight) && weight > 0 ? weight : 0;
  return correct
    ? { alpha: p.alpha + w, beta: p.beta }
    : { alpha: p.alpha, beta: p.beta + w };
}

export function evidenceCount(p: BetaParams): number {
  return Math.max(0, p.alpha + p.beta - 2);
}

export function masteryMean(p: BetaParams): number {
  return p.alpha / (p.alpha + p.beta);
}

export function classifyMastery(p: BetaParams): MasteryState {
  const n = evidenceCount(p) + EPS;
  const mean = masteryMean(p);
  if (mean >= MASTERED_MIN_MEAN - EPS && n >= MASTERED_MIN_N) return "mastered";
  if (mean < GAP_MAX_MEAN - EPS && n >= GAP_MIN_N) return "gap";
  if (n < INSUFFICIENT_BELOW_N) return "insufficient";
  return "learning";
}

// ---------------------------------------------------------------------------
// Beta quantile (pure, no deps): regularized incomplete beta via Lentz's
// continued fraction + bisection on the CDF.
// ---------------------------------------------------------------------------

function lnGamma(z: number): number {
  // Lanczos approximation (g = 7, n = 9)
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  const x = z - 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(x: number, a: number, b: number): number {
  const MAXIT = 300;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b) = CDF of Beta(a, b) at x. */
export function betaCdf(x: number, a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return NaN;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront =
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lnFront);
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(x, a, b)) / a;
  return 1 - (front * betacf(1 - x, b, a)) / b;
}

/** Inverse CDF of Beta(a, b) by bisection (monotone, robust). */
export function betaQuantile(q: number, a: number, b: number): number {
  if (!(a > 0) || !(b > 0) || !(q >= 0 && q <= 1)) return NaN;
  if (q === 0) return 0;
  if (q === 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < q) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}

export type MasterySummary = {
  alpha: number;
  beta: number;
  /** weighted evidence count = alpha + beta - 2 */
  n: number;
  mean: number;
  /** 80% one-sided lower credible bound (20% quantile) */
  lower80: number;
  /** weighted correct = alpha - 1 */
  correct: number;
  /** weighted wrong = beta - 1 */
  wrong: number;
  state: MasteryState;
};

function round(x: number, d = 4) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

export function summarize(p: BetaParams): MasterySummary {
  return {
    alpha: round(p.alpha),
    beta: round(p.beta),
    n: round(evidenceCount(p)),
    mean: round(masteryMean(p)),
    lower80: round(betaQuantile(LOWER_BOUND_Q, p.alpha, p.beta)),
    correct: round(Math.max(0, p.alpha - PRIOR.alpha)),
    wrong: round(Math.max(0, p.beta - PRIOR.beta)),
    state: classifyMastery(p),
  };
}

// ---------------------------------------------------------------------------
// Observations -> per-LC deltas
// ---------------------------------------------------------------------------

export type ItemObservation = {
  /** All LCs the item is tagged with (deduped; empty items are ignored). */
  lcIds: string[];
  correct: boolean;
};

export type BetaDelta = { lcId: string; dAlpha: number; dBeta: number };

/**
 * Split policy: an item tagged with k LCs contributes 1/k to each LC.
 * Returns one aggregated delta per LC (stable order of first appearance).
 */
export function deltasFromObservations(obs: ItemObservation[]): BetaDelta[] {
  const acc = new Map<string, BetaDelta>();
  for (const o of obs) {
    const ids = [...new Set((o.lcIds ?? []).map((s) => String(s).trim()).filter(Boolean))];
    if (ids.length === 0) continue;
    const w = 1 / ids.length;
    for (const id of ids) {
      const d = acc.get(id) ?? { lcId: id, dAlpha: 0, dBeta: 0 };
      if (o.correct) d.dAlpha += w;
      else d.dBeta += w;
      acc.set(id, d);
    }
  }
  return [...acc.values()];
}

export function applyDeltas(
  current: Map<string, BetaParams>,
  deltas: BetaDelta[],
): Map<string, BetaParams> {
  const next = new Map(current);
  for (const d of deltas) {
    const p = next.get(d.lcId) ?? prior();
    next.set(d.lcId, { alpha: p.alpha + d.dAlpha, beta: p.beta + d.dBeta });
  }
  return next;
}

/** Posterior from per-LC correct/total tallies (e.g. one graded session). */
export function posteriorsFromTallies(
  rows: Array<{ componentId: string; correct: number; total: number }>,
): Map<string, BetaParams> {
  const out = new Map<string, BetaParams>();
  for (const r of rows) {
    const total = Math.max(0, Number(r.total) || 0);
    const correct = Math.min(total, Math.max(0, Number(r.correct) || 0));
    const p = out.get(r.componentId) ?? prior();
    out.set(r.componentId, {
      alpha: p.alpha + correct,
      beta: p.beta + (total - correct),
    });
  }
  return out;
}

/**
 * Pool several LC posteriors into one standard-level posterior by summing
 * their evidence on top of a single Beta(1,1) prior. LCs without data add
 * nothing, so a standard with no observed LC stays "insufficient".
 */
export function poolPosteriors(parts: BetaParams[]): BetaParams {
  let a = PRIOR.alpha;
  let b = PRIOR.beta;
  for (const p of parts) {
    a += Math.max(0, p.alpha - PRIOR.alpha);
    b += Math.max(0, p.beta - PRIOR.beta);
  }
  return { alpha: a, beta: b };
}

// ---------------------------------------------------------------------------
// Heatmap (standard -> LC)
// ---------------------------------------------------------------------------

export type HeatmapStandardMeta = {
  id: string;
  code: string | null;
  description: string;
  jurisdiction?: string;
  gradeLevel?: string[];
};

export type HeatmapLcMeta = {
  id: string;
  description: string;
  standards: HeatmapStandardMeta[];
};

export type HeatmapCell = {
  lcId: string;
  description: string;
  summary: MasterySummary;
};

export type HeatmapRow = {
  standardId: string;
  code: string | null;
  description: string;
  summary: MasterySummary;
  cells: HeatmapCell[];
};

function normGrade(g: string | undefined | null): string | null {
  const t = String(g ?? "").trim();
  if (/^k$/i.test(t)) return "K";
  if (/^\d{1,2}$/.test(t)) return String(Number(t));
  return null;
}

/**
 * An LC usually supports many standards across jurisdictions. To keep the
 * grid readable (and keep root-gap tracing on the CCSS progression graph)
 * each LC is placed under ONE primary standard, chosen deterministically:
 *   1. Multi-State (CCSS) with a code
 *   2. learner's jurisdiction with a code
 *   3. any standard with a code
 *   4. anything
 * Within each tier: standards whose gradeLevel includes the learner grade
 * first, then by code (numeric-aware), then id. Input order never matters.
 */
export function pickPrimaryStandard(
  standards: HeatmapStandardMeta[],
  jurisdiction?: string,
  grade?: string,
): HeatmapStandardMeta | null {
  if (!standards.length) return null;
  const jur = jurisdiction?.trim();
  const g = normGrade(grade);
  const tier = (s: HeatmapStandardMeta) => {
    const ms = (s.jurisdiction ?? "Multi-State") === "Multi-State";
    if (ms && s.code) return 0;
    if (jur && s.jurisdiction === jur && s.code) return 1;
    if (s.code) return 2;
    return 3;
  };
  const gradeMiss = (s: HeatmapStandardMeta) =>
    g && (s.gradeLevel ?? []).some((x) => normGrade(x) === g) ? 0 : 1;
  const sorted = [...standards].sort(
    (a, b) =>
      tier(a) - tier(b) ||
      gradeMiss(a) - gradeMiss(b) ||
      (a.code ?? "").localeCompare(b.code ?? "", "en", { numeric: true }) ||
      a.id.localeCompare(b.id),
  );
  return sorted[0];
}

export function buildHeatmap(params: {
  posteriors: Map<string, BetaParams>;
  lcMeta: HeatmapLcMeta[];
  jurisdiction?: string;
  grade?: string;
}): HeatmapRow[] {
  const metaById = new Map(params.lcMeta.map((m) => [m.id, m]));
  const rows = new Map<string, HeatmapRow & { parts: BetaParams[] }>();
  for (const [lcId, p] of params.posteriors) {
    const meta = metaById.get(lcId);
    const std = meta ? pickPrimaryStandard(meta.standards, params.jurisdiction, params.grade) : null;
    const key = std?.id ?? "unmapped";
    const row =
      rows.get(key) ??
      ({
        standardId: key,
        code: std?.code ?? null,
        description: std?.description ?? "Skills without a mapped standard",
        summary: summarize(prior()),
        cells: [],
        parts: [],
      } as HeatmapRow & { parts: BetaParams[] });
    row.cells.push({
      lcId,
      description: meta?.description ?? lcId,
      summary: summarize(p),
    });
    row.parts.push(p);
    rows.set(key, row);
  }
  const out: HeatmapRow[] = [];
  for (const r of rows.values()) {
    r.cells.sort((a, b) => a.summary.mean - b.summary.mean || a.description.localeCompare(b.description));
    out.push({
      standardId: r.standardId,
      code: r.code,
      description: r.description,
      summary: summarize(poolPosteriors(r.parts)),
      cells: r.cells,
    });
  }
  out.sort((a, b) => (a.code ?? "~").localeCompare(b.code ?? "~", undefined, { numeric: true }));
  return out;
}
