import { dbEnabled, dbQuery, noteDbTimeout } from "@/lib/db/client";
import { logError } from "@/lib/log-safe";
import {
  PIN_CODE_MAX_FAILURES,
  PIN_LOGIN_MAX_FAILURES,
  PIN_LOGIN_WINDOW_MS,
  type MemoryEntry,
  type PinRateLimitResult,
  clearMemoryFailures as clearMemory,
  combineRateLimitResults,
  inspectMemoryRateLimit as inspectMemory,
  pinLoginCodeRateKey,
  pinLoginRateKey,
  recordMemoryFailure as recordMemory,
  toRateLimitResult,
} from "@/lib/pin-rate-limit-core";

export {
  PIN_CODE_MAX_FAILURES,
  PIN_LOGIN_MAX_FAILURES,
  PIN_LOGIN_WINDOW_MS,
  getClientIp,
  pinLoginCodeRateKey,
  pinLoginRateKey,
  type PinRateLimitResult,
} from "@/lib/pin-rate-limit-core";

/**
 * Learner PIN login brute-force protection.
 *
 * Two layers, same 15-minute window (`PIN_LOGIN_WINDOW_MS`):
 *   - IP + learner code: 5 failures (`PIN_LOGIN_MAX_FAILURES`)
 *   - learner code only (any IP): 10 failures (`PIN_CODE_MAX_FAILURES`)
 * After either layer trips, a later correct PIN still receives 429 (the
 * login route checks both layers before verifying the PIN).
 *
 * A successful login (when not already locked) clears both buckets so typo
 * counts do not carry into the next session. During lockout we never reach
 * a successful verify, so an attacker can still lock a learner's code for
 * 15 minutes with 10 failures from rotating IPs — that is the tradeoff for
 * stopping IP-rotation brute force (temporary, not permanent).
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

/** Short timeout so a hanging DB cannot stall login for the pool's 10s. */
export const RATE_LIMIT_QUERY_TIMEOUT_MS = 1_500;
/** After a failed ensure/query, skip the DB until this backoff elapses. */
export const RATE_LIMIT_ENSURE_BACKOFF_MS = 30_000;

const ENSURE_TABLE_SQL = `
create table if not exists amc_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  fail_count int not null default 0,
  updated_at timestamptz not null default now()
)
`;

let tableReady: Promise<boolean> | null = null;
let tableReadyOk = false;
let nextEnsureAt = 0;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Create the rate-limit table at most once per isolate. The promise is
 * cached so concurrent logins share one attempt. Failures are cached with
 * a backoff so a hanging / down DB is not retried on every request.
 */
async function ensureRateLimitTable(): Promise<boolean> {
  if (!dbEnabled()) return false;
  if (tableReadyOk && tableReady) return tableReady;
  if (tableReady) return tableReady;
  if (Date.now() < nextEnsureAt) return false;

  tableReady = (async () => {
    try {
      await withTimeout(
        dbQuery(ENSURE_TABLE_SQL),
        RATE_LIMIT_QUERY_TIMEOUT_MS,
        "ensureRateLimitTable",
      );
      tableReadyOk = true;
      return true;
    } catch (err) {
      tableReady = null;
      tableReadyOk = false;
      nextEnsureAt = Date.now() + RATE_LIMIT_ENSURE_BACKOFF_MS;
      noteDbTimeout(err);
      logError("amc_rate_limits ensure table failed", err);
      return false;
    }
  })();
  return tableReady;
}

const memoryStore = new Map<string, MemoryEntry>();

export function inspectMemoryRateLimit(
  key: string,
  now = Date.now(),
  maxFailures: number = PIN_LOGIN_MAX_FAILURES,
): PinRateLimitResult {
  return inspectMemory(memoryStore, key, now, maxFailures);
}

export function recordMemoryFailure(
  key: string,
  now = Date.now(),
  maxFailures: number = PIN_LOGIN_MAX_FAILURES,
) {
  return recordMemory(memoryStore, key, now, maxFailures);
}

export function clearMemoryFailures(key: string) {
  clearMemory(memoryStore, key);
}

async function dbCheck(
  key: string,
  maxFailures: number,
): Promise<PinRateLimitResult | null> {
  const ok = await ensureRateLimitTable();
  if (!ok) return null;
  try {
    const now = Date.now();
    const { rows } = await withTimeout(
      dbQuery<{
        window_started_at: Date | string;
        fail_count: number;
      }>(
        `select window_started_at, fail_count from amc_rate_limits where rate_key = $1`,
        [key],
      ),
      RATE_LIMIT_QUERY_TIMEOUT_MS,
      "rateLimitCheck",
    );
    const row = rows[0];
    if (!row) return toRateLimitResult(0, now, now, maxFailures);
    const start = new Date(row.window_started_at).getTime();
    return toRateLimitResult(Number(row.fail_count) || 0, start, now, maxFailures);
  } catch (err) {
    nextEnsureAt = Date.now() + RATE_LIMIT_ENSURE_BACKOFF_MS;
    noteDbTimeout(err);
      logError("amc_rate_limits check failed", err);
    return null;
  }
}

async function dbRecordFailure(key: string): Promise<boolean> {
  const ok = await ensureRateLimitTable();
  if (!ok) return false;
  try {
    const now = new Date();
    const windowStartCutoff = new Date(now.getTime() - PIN_LOGIN_WINDOW_MS);
    await withTimeout(
      dbQuery(
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
      ),
      RATE_LIMIT_QUERY_TIMEOUT_MS,
      "rateLimitIncrement",
    );
    return true;
  } catch (err) {
    nextEnsureAt = Date.now() + RATE_LIMIT_ENSURE_BACKOFF_MS;
    noteDbTimeout(err);
      logError("amc_rate_limits increment failed", err);
    return false;
  }
}

async function dbClear(key: string): Promise<boolean> {
  const ok = await ensureRateLimitTable();
  if (!ok) return false;
  try {
    await withTimeout(
      dbQuery(`delete from amc_rate_limits where rate_key = $1`, [key]),
      RATE_LIMIT_QUERY_TIMEOUT_MS,
      "rateLimitClear",
    );
    return true;
  } catch (err) {
    nextEnsureAt = Date.now() + RATE_LIMIT_ENSURE_BACKOFF_MS;
    noteDbTimeout(err);
      logError("amc_rate_limits clear failed", err);
    return false;
  }
}

async function checkOne(
  key: string,
  maxFailures: number,
): Promise<PinRateLimitResult> {
  const fromDb = await dbCheck(key, maxFailures);
  if (fromDb) return fromDb;
  return inspectMemoryRateLimit(key, Date.now(), maxFailures);
}

export async function checkPinLoginLimits(
  ip: string,
  code: string,
): Promise<PinRateLimitResult> {
  const ipKey = pinLoginRateKey(ip, code);
  const codeKey = pinLoginCodeRateKey(code);
  const [ipLimit, codeLimit] = await Promise.all([
    checkOne(ipKey, PIN_LOGIN_MAX_FAILURES),
    checkOne(codeKey, PIN_CODE_MAX_FAILURES),
  ]);
  return combineRateLimitResults(ipLimit, codeLimit);
}

/** @deprecated use checkPinLoginLimits */
export async function checkPinLoginRateLimit(
  key: string,
  maxFailures: number = PIN_LOGIN_MAX_FAILURES,
): Promise<PinRateLimitResult> {
  return checkOne(key, maxFailures);
}

export async function recordPinLoginFailure(
  ip: string,
  code: string,
): Promise<void> {
  const ipKey = pinLoginRateKey(ip, code);
  const codeKey = pinLoginCodeRateKey(code);
  await Promise.all([dbRecordFailure(ipKey), dbRecordFailure(codeKey)]);
  // Always update memory so a subsequent request on this isolate still
  // sees the failure if the DB write was skipped or lagged.
  recordMemoryFailure(ipKey, Date.now(), PIN_LOGIN_MAX_FAILURES);
  recordMemoryFailure(codeKey, Date.now(), PIN_CODE_MAX_FAILURES);
}

export async function clearPinLoginFailures(
  ip: string,
  code: string,
): Promise<void> {
  const ipKey = pinLoginRateKey(ip, code);
  const codeKey = pinLoginCodeRateKey(code);
  await Promise.all([dbClear(ipKey), dbClear(codeKey)]);
  clearMemoryFailures(ipKey);
  clearMemoryFailures(codeKey);
}
