import { dbEnabled, dbQuery } from "@/lib/db/client";
import {
  PIN_LOGIN_WINDOW_MS,
  type MemoryEntry,
  type PinRateLimitResult,
  clearMemoryFailures as clearMemory,
  inspectMemoryRateLimit as inspectMemory,
  recordMemoryFailure as recordMemory,
  toRateLimitResult,
} from "@/lib/pin-rate-limit-core";

export {
  PIN_LOGIN_MAX_FAILURES,
  PIN_LOGIN_WINDOW_MS,
  getClientIp,
  pinLoginRateKey,
  type PinRateLimitResult,
} from "@/lib/pin-rate-limit-core";

/**
 * Learner PIN login brute-force protection.
 *
 * Defaults: 5 failed attempts per IP+learner-code in a 15-minute window
 * (`PIN_LOGIN_MAX_FAILURES`, `PIN_LOGIN_WINDOW_MS`).
 *
 * Preferred store is Postgres (`amc_rate_limits`) so the limit is shared
 * across Vercel serverless isolates. If the DB is unavailable, we fall
 * back to an in-memory map.
 *
 * In-memory fallback limitation: each serverless isolate has its own
 * memory, so counters do not aggregate across instances and are lost
 * on cold start. That is weaker protection; it is only a best-effort
 * backup until Postgres is reachable.
 */

const ENSURE_TABLE_SQL = `
create table if not exists amc_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  fail_count int not null default 0,
  updated_at timestamptz not null default now()
)
`;

let tableReady: Promise<boolean> | null = null;

async function ensureRateLimitTable(): Promise<boolean> {
  if (!dbEnabled()) return false;
  if (!tableReady) {
    tableReady = dbQuery(ENSURE_TABLE_SQL)
      .then(() => true)
      .catch((err) => {
        tableReady = null;
        console.error(
          "amc_rate_limits ensure table failed",
          err instanceof Error ? err.message : err,
        );
        return false;
      });
  }
  return tableReady;
}

const memoryStore = new Map<string, MemoryEntry>();

export function inspectMemoryRateLimit(
  key: string,
  now = Date.now(),
): PinRateLimitResult {
  return inspectMemory(memoryStore, key, now);
}

export function recordMemoryFailure(key: string, now = Date.now()) {
  return recordMemory(memoryStore, key, now);
}

export function clearMemoryFailures(key: string) {
  clearMemory(memoryStore, key);
}

async function dbCheck(key: string): Promise<PinRateLimitResult | null> {
  const ok = await ensureRateLimitTable();
  if (!ok) return null;
  try {
    const now = Date.now();
    const { rows } = await dbQuery<{
      window_started_at: Date | string;
      fail_count: number;
    }>(
      `select window_started_at, fail_count from amc_rate_limits where rate_key = $1`,
      [key],
    );
    const row = rows[0];
    if (!row) return toRateLimitResult(0, now, now);
    const start = new Date(row.window_started_at).getTime();
    return toRateLimitResult(Number(row.fail_count) || 0, start, now);
  } catch (err) {
    console.error(
      "amc_rate_limits check failed",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function dbRecordFailure(key: string): Promise<boolean> {
  const ok = await ensureRateLimitTable();
  if (!ok) return false;
  try {
    const now = new Date();
    const windowStartCutoff = new Date(now.getTime() - PIN_LOGIN_WINDOW_MS);
    await dbQuery(
      `insert into amc_rate_limits (rate_key, window_started_at, fail_count, updated_at)
       values ($1, $2, 1, $2)
       on conflict (rate_key) do update set
         fail_count = case
           when amc_rate_limits.window_started_at <= $3 then 1
           else amc_rate_limits.fail_count + 1
         end,
         window_started_at = case
           when amc_rate_limits.window_started_at <= $3 then $2
           else amc_rate_limits.window_started_at
         end,
         updated_at = $2`,
      [key, now, windowStartCutoff],
    );
    return true;
  } catch (err) {
    console.error(
      "amc_rate_limits increment failed",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

async function dbClear(key: string): Promise<boolean> {
  const ok = await ensureRateLimitTable();
  if (!ok) return false;
  try {
    await dbQuery(`delete from amc_rate_limits where rate_key = $1`, [key]);
    return true;
  } catch (err) {
    console.error(
      "amc_rate_limits clear failed",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

export async function checkPinLoginRateLimit(
  key: string,
): Promise<PinRateLimitResult> {
  const fromDb = await dbCheck(key);
  if (fromDb) return fromDb;
  return inspectMemoryRateLimit(key);
}

export async function recordPinLoginFailure(key: string): Promise<void> {
  await dbRecordFailure(key);
  // Always update memory so a subsequent request on this isolate still
  // sees the failure if the DB write was skipped or lagged.
  recordMemoryFailure(key);
}

export async function clearPinLoginFailures(key: string): Promise<void> {
  await dbClear(key);
  clearMemoryFailures(key);
}
