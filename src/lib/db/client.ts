import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { buildPoolConfig } from "./pool-config";

let pool: Pool | null = null;
let dbUnavailableUntil = 0;

export const DEFAULT_DB_CONNECT_TIMEOUT_MS = 2_500;
export const DEFAULT_DB_QUERY_TIMEOUT_MS = 2_500;
export const DEFAULT_DB_FAIL_BACKOFF_MS = 5_000;

function positiveEnvMs(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getDbConnectTimeoutMs() {
  return positiveEnvMs("DB_CONNECT_TIMEOUT_MS", DEFAULT_DB_CONNECT_TIMEOUT_MS);
}

export function getDbQueryTimeoutMs() {
  return positiveEnvMs("DB_QUERY_TIMEOUT_MS", DEFAULT_DB_QUERY_TIMEOUT_MS);
}

export function getDbFailBackoffMs() {
  return positiveEnvMs("DB_FAIL_BACKOFF_MS", DEFAULT_DB_FAIL_BACKOFF_MS);
}

export function isDbTimeoutError(err: unknown): boolean {
  if (err == null) return false;
  const code =
    typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code ?? "")
      : "";
  if (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "57014" // query_canceled (statement_timeout)
  ) {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return (
    /timeout/i.test(message) ||
    /timed out/i.test(message) ||
    /database temporarily unavailable/i.test(message) ||
    /terminat(?:ed|ing) due to connection timeout/i.test(message)
  );
}

function markDbUnavailable() {
  dbUnavailableUntil = Date.now() + getDbFailBackoffMs();
}

/**
 * Seconds for a 503 Retry-After header when the DB fail-fast path trips.
 * Uses ceil(remaining backoff) when a cooldown is active; otherwise the
 * full DB_FAIL_BACKOFF_MS window (when remaining-time info is missing).
 */
export function computeDbFailRetryAfterSec(
  now: number,
  unavailableUntil: number,
  backoffMs: number,
): number {
  const remaining = unavailableUntil - now;
  if (remaining > 0) return Math.max(1, Math.ceil(remaining / 1000));
  return Math.max(1, Math.ceil(backoffMs / 1000));
}

export function getDbFailRetryAfterSec(now: number = Date.now()): number {
  return computeDbFailRetryAfterSec(
    now,
    dbUnavailableUntil,
    getDbFailBackoffMs(),
  );
}

/** Build the 503 + Retry-After init used by routes on the DB fail-fast path. */
export function dbFailFastResponseInit(now: number = Date.now()): {
  status: 503;
  headers: { "Retry-After": string };
} {
  return {
    status: 503,
    headers: { "Retry-After": String(getDbFailRetryAfterSec(now)) },
  };
}

/** Record a timeout seen outside dbQuery (e.g. a Promise.race cap). */
export function noteDbTimeout(err: unknown) {
  if (isDbTimeoutError(err)) markDbUnavailable();
}

function assertDbAvailable() {
  if (Date.now() < dbUnavailableUntil) {
    throw new Error("database temporarily unavailable");
  }
}

/** Test-only: set or clear the fail-fast cooldown clock. */
export function setDbUnavailableUntilForTests(ts: number) {
  dbUnavailableUntil = ts;
}

export function getDatabaseUrl(): string | null {
  const url =
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    null;
  return url || null;
}

export function dbEnabled() {
  return Boolean(getDatabaseUrl());
}

export function getPool(): Pool {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error("No DATABASE_URL / POSTGRES_URL configured");
  }
  if (!pool) {
    const { connectionString, ssl } = buildPoolConfig(url);
    const connectTimeout = getDbConnectTimeoutMs();
    const queryTimeout = getDbQueryTimeoutMs();
    pool = new Pool({
      connectionString,
      ssl,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: connectTimeout,
      // Client-side cap on a single query. 2.5s is enough for this app's
      // short CRUD statements and keeps a hung login from stalling.
      query_timeout: queryTimeout,
      // Server-side cap (ms) once the session is established.
      statement_timeout: queryTimeout,
    });
  }
  return pool;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  assertDbAvailable();
  try {
    return await getPool().query<T>(text, params);
  } catch (err) {
    if (isDbTimeoutError(err)) markDbUnavailable();
    throw err;
  }
}

export async function withDbClient<T>(fn: (c: PoolClient) => Promise<T>) {
  assertDbAvailable();
  let client: PoolClient;
  try {
    client = await getPool().connect();
  } catch (err) {
    if (isDbTimeoutError(err)) markDbUnavailable();
    throw err;
  }
  try {
    return await fn(client);
  } catch (err) {
    if (isDbTimeoutError(err)) markDbUnavailable();
    throw err;
  } finally {
    client.release();
  }
}

export function sessionStoreKind():
  | "supabase"
  | "vercel-blob"
  | "local-fs"
  | "tmp-fs"
  | "none" {
  if (dbEnabled()) return "supabase";
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return "vercel-blob";
  if (process.env.VERCEL) return "tmp-fs";
  return "local-fs";
}
