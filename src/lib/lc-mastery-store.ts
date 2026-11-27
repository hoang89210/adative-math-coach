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
 * Fallback: an in-memory map per server instance, used ONLY when no
 * database is configured at all. If a database IS configured but is down or
 * timing out, load/record THROW (isDbTimeoutError) so routes can answer
 * 503 + Retry-After instead of an empty "memory" report that looks like
 * the learner has no data. Memory is still updated on a successful path
 * (and on the no-DB path). Limitation: memory is per isolate and lost on
 * cold start; the client additionally keeps a localStorage snapshot
 * (see /progress) for the no-DB case.
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
  if (Date.now() < nextEnsureAt) {
    // Backoff after a failed ensure: do not return false (that used to
    // look like "no table / use memory"). The DB is configured.
    throw new Error("database temporarily unavailable");
  }
  tableReady = (async () => {
    try {
      // Existence check first: a runtime role without CREATE on the schema
      // (e.g. amc_app on PG15+) fails `create table if not exists` even when
      // the table already exists (migration 003), which would silently push
      // every learner to the in-memory fallback.
      const { rows } = await withTimeout(
        dbQuery<{ t: string | null }>(`select to_regclass('amc_lc_mastery')::text as t`),
        LC_MASTERY_QUERY_TIMEOUT_MS,
        "checkLcMasteryTable",
      );
      if (!rows[0]?.t) {
        await withTimeout(dbQuery(ENSURE_TABLE_SQL), LC_MASTERY_QUERY_TIMEOUT_MS, "ensureLcMasteryTable");
      }
      tableReadyOk = true;
      return true;
    } catch (err) {
      tableReady = null;
      tableReadyOk = false;
      nextEnsureAt = Date.now() + LC_MASTERY_ENSURE_BACKOFF_MS;
      noteDbTimeout(err);
      logError("amc_lc_mastery ensure table failed", err);
      // DB is configured (we returned earlier if not): never pretend the
      // table is simply "not ready" — that used to push callers onto the
      // in-memory fallback and hide the outage.
      throw err;
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
  if (!dbEnabled()) {
    memApply(learnerId, clean);
    return "memory";
  }

  // DB configured: require a durable write. Memory is updated only after
  // the upsert succeeds so a retried request cannot read a write that
  // never reached Postgres.
  await ensureTable();
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
    memApply(learnerId, clean);
    return "db";
  } catch (err) {
    nextEnsureAt = Date.now() + LC_MASTERY_ENSURE_BACKOFF_MS;
    tableReady = null;
    tableReadyOk = false;
    noteDbTimeout(err);
    logError("amc_lc_mastery upsert failed", err);
    throw err;
  }
}

function fromMemory(learnerId: string): LcMasteryLoad {
  const empty: LcMasteryLoad = { source: "memory", posteriors: new Map(), updatedAt: {} };
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

export async function loadLcMastery(learnerId: string): Promise<LcMasteryLoad> {
  const empty: LcMasteryLoad = { source: "memory", posteriors: new Map(), updatedAt: {} };
  if (!isValidLearnerId(learnerId)) return empty;

  // Memory fallback is only for deployments with no database configured.
  if (!dbEnabled()) return fromMemory(learnerId);

  await ensureTable();
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
    throw err;
  }
}
