import { dbEnabled, dbQuery, noteDbTimeout } from "@/lib/db/client";
import { type BetaDelta, type BetaParams, prior } from "@/lib/lc-mastery";
import { logError } from "@/lib/log-safe";

/**
 * Persistence for per-learner LC Beta posteriors.
 *
 * Preferred store: Postgres table `amc_lc_mastery` (migration 003). Same
 * pattern as `amc_rate_limits`: CREATE TABLE IF NOT EXISTS cached once per
 * isolate, short per-query timeout, and a backoff after a failure so a down
 * DB is not retried on every request.
 *
 * Fallback (no DB configured / DB failing): an in-memory map per server
 * instance. It is ALWAYS updated too, so a request on the same instance can
 * still read evidence if the DB later fails. Limitation: memory is per
 * isolate and lost on cold start; the client additionally keeps a
 * localStorage snapshot (see /progress) for that case.
 */

export const LC_MASTERY_QUERY_TIMEOUT_MS = 2_000;
export const LC_MASTERY_ENSURE_BACKOFF_MS = 30_000;
const MAX_ROWS_PER_LEARNER = 2_000;

const ENSURE_TABLE_SQL = `
create table if not exists amc_lc_mastery (
  learner_id uuid not null,
  lc_id text not null,
  alpha double precision not null default 1 check (alpha >= 1),
  beta double precision not null default 1 check (beta >= 1),
  updated_at timestamptz not null default now(),
  primary key (learner_id, lc_id)
)
`;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidLearnerId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id.trim());
}

let tableReady: Promise<boolean> | null = null;
let tableReadyOk = false;
let nextEnsureAt = 0;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function ensureTable(): Promise<boolean> {
  if (!dbEnabled()) return false;
  if (tableReadyOk && tableReady) return tableReady;
  if (tableReady) return tableReady;
  if (Date.now() < nextEnsureAt) return false;
  tableReady = (async () => {
    try {
      await withTimeout(dbQuery(ENSURE_TABLE_SQL), LC_MASTERY_QUERY_TIMEOUT_MS, "ensureLcMasteryTable");
      tableReadyOk = true;
      return true;
    } catch (err) {
      tableReady = null;
      tableReadyOk = false;
      nextEnsureAt = Date.now() + LC_MASTERY_ENSURE_BACKOFF_MS;
      noteDbTimeout(err);
      logError("amc_lc_mastery ensure table failed", err);
      return false;
    }
  })();
  return tableReady;
}

type MemRow = BetaParams & { updatedAt: string };
const memory = new Map<string, Map<string, MemRow>>();

function memApply(learnerId: string, deltas: BetaDelta[]) {
  const key = learnerId.toLowerCase();
  const m = memory.get(key) ?? new Map<string, MemRow>();
  const now = new Date().toISOString();
  for (const d of deltas) {
    const p = m.get(d.lcId) ?? { ...prior(), updatedAt: now };
    m.set(d.lcId, { alpha: p.alpha + d.dAlpha, beta: p.beta + d.dBeta, updatedAt: now });
  }
  memory.set(key, m);
}

/** Test helper. */
export function resetLcMasteryMemoryForTests() {
  memory.clear();
  tableReady = null;
  tableReadyOk = false;
  nextEnsureAt = 0;
}

export type LcMasteryLoad = {
  source: "db" | "memory";
  posteriors: Map<string, BetaParams>;
  updatedAt: Record<string, string>;
};

/** Apply deltas for a learner. Returns where it was durably stored. */
export async function recordLcEvidence(
  learnerId: string,
  deltas: BetaDelta[],
): Promise<"db" | "memory" | "skipped"> {
  if (!isValidLearnerId(learnerId)) return "skipped";
  const clean = deltas.filter(
    (d) => d.lcId && d.lcId.length <= 200 && d.dAlpha >= 0 && d.dBeta >= 0 && d.dAlpha + d.dBeta > 0,
  );
  if (!clean.length) return "skipped";
  memApply(learnerId, clean);

  if (!(await ensureTable())) return "memory";
  try {
    await withTimeout(
      dbQuery(
        `insert into amc_lc_mastery (learner_id, lc_id, alpha, beta, updated_at)
         select $1::uuid, d.lc_id, 1 + d.da, 1 + d.db, now()
         from unnest($2::text[], $3::float8[], $4::float8[]) as d(lc_id, da, db)
         on conflict (learner_id, lc_id) do update set
           alpha = amc_lc_mastery.alpha + (excluded.alpha - 1),
           beta = amc_lc_mastery.beta + (excluded.beta - 1),
           updated_at = now()`,
        [
          learnerId,
          clean.map((d) => d.lcId),
          clean.map((d) => d.dAlpha),
          clean.map((d) => d.dBeta),
        ],
      ),
      LC_MASTERY_QUERY_TIMEOUT_MS,
      "lcMasteryUpsert",
    );
    return "db";
  } catch (err) {
    nextEnsureAt = Date.now() + LC_MASTERY_ENSURE_BACKOFF_MS;
    tableReady = null;
    tableReadyOk = false;
    noteDbTimeout(err);
    logError("amc_lc_mastery upsert failed", err);
    return "memory";
  }
}

export async function loadLcMastery(learnerId: string): Promise<LcMasteryLoad> {
  const empty: LcMasteryLoad = { source: "memory", posteriors: new Map(), updatedAt: {} };
  if (!isValidLearnerId(learnerId)) return empty;

  if (await ensureTable()) {
    try {
      const { rows } = await withTimeout(
        dbQuery<{ lc_id: string; alpha: number; beta: number; updated_at: Date | string }>(
          `select lc_id, alpha, beta, updated_at from amc_lc_mastery
           where learner_id = $1::uuid order by updated_at desc limit ${MAX_ROWS_PER_LEARNER}`,
          [learnerId],
        ),
        LC_MASTERY_QUERY_TIMEOUT_MS,
        "lcMasteryLoad",
      );
      const posteriors = new Map<string, BetaParams>();
      const updatedAt: Record<string, string> = {};
      for (const r of rows) {
        posteriors.set(r.lc_id, { alpha: Number(r.alpha), beta: Number(r.beta) });
        updatedAt[r.lc_id] = new Date(r.updated_at).toISOString();
      }
      return { source: "db", posteriors, updatedAt };
    } catch (err) {
      nextEnsureAt = Date.now() + LC_MASTERY_ENSURE_BACKOFF_MS;
      tableReady = null;
      tableReadyOk = false;
      noteDbTimeout(err);
      logError("amc_lc_mastery load failed", err);
    }
  }

  const m = memory.get(learnerId.toLowerCase());
  if (!m) return empty;
  const posteriors = new Map<string, BetaParams>();
  const updatedAt: Record<string, string> = {};
  for (const [lc, row] of m) {
    posteriors.set(lc, { alpha: row.alpha, beta: row.beta });
    updatedAt[lc] = row.updatedAt;
  }
  return { source: "memory", posteriors, updatedAt };
}
