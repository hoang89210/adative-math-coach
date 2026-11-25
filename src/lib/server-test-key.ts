import { getClientIp } from "./pin-rate-limit-core";

/** Client header that requests server-key (test) mode. Server still decides. */
export const SERVER_TEST_KEY_HEADER = "x-use-server-key";

const DEFAULT_MAX_CALLS = 20;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export function parseAllowServerTestKeyFlag(
  value: string | undefined = process.env.ALLOW_SERVER_TEST_KEY,
): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function getServerTestKeyMaxCalls(
  raw: string | undefined = process.env.SERVER_TEST_KEY_MAX_CALLS,
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_CALLS;
}

export function getServerTestKeyWindowMs(
  raw: string | undefined = process.env.SERVER_TEST_KEY_WINDOW_MS,
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_WINDOW_MS;
}

/** True only when the test flag is on AND the server has OPENAI_API_KEY. */
export function isServerTestKeyEnabled(
  flag: boolean = parseAllowServerTestKeyFlag(),
  hasServerKey: boolean = Boolean(process.env.OPENAI_API_KEY?.trim()),
): boolean {
  return flag && hasServerKey;
}

export function wantsServerTestKey(request: Request): boolean {
  const raw =
    request.headers.get(SERVER_TEST_KEY_HEADER)?.trim() ||
    request.headers.get("X-Use-Server-Key")?.trim() ||
    "";
  const v = raw.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export type KeySelectInput = {
  useServerKey: boolean;
  allowServerTestKey: boolean;
  serverKey?: string;
  userKey?: string;
  envKey?: string;
};

export type KeySelectOk = {
  ok: true;
  source: "server" | "user" | "env";
  key: string;
};

export type KeySelectErr = {
  ok: false;
  status: 403;
  error: string;
};

export type KeySelectResult = KeySelectOk | KeySelectErr;

const NO_KEY_MESSAGE =
  "No OpenAI API key. Paste your key on the home page, or set OPENAI_API_KEY on the server.";

const SERVER_KEY_DISABLED_MESSAGE =
  "Server test key is not enabled. Paste your own OpenAI API key, or ask an admin to set ALLOW_SERVER_TEST_KEY=1 with OPENAI_API_KEY.";

/**
 * Pick which API key to use. When useServerKey is requested, the server key is
 * used only if the flag is on and a server key exists — otherwise the request
 * is rejected (do not fall back to a user key, and never return the key).
 */
export function selectLlmApiKey(input: KeySelectInput): KeySelectResult {
  if (input.useServerKey) {
    const serverKey = input.serverKey?.trim() ?? "";
    if (!input.allowServerTestKey || !serverKey) {
      return { ok: false, status: 403, error: SERVER_KEY_DISABLED_MESSAGE };
    }
    return { ok: true, source: "server", key: serverKey };
  }

  const userKey = input.userKey?.trim();
  if (userKey) return { ok: true, source: "user", key: userKey };

  const envKey = input.envKey?.trim();
  if (envKey) return { ok: true, source: "env", key: envKey };

  return { ok: false, status: 403, error: NO_KEY_MESSAGE };
}

export type LimitOk = { ok: true; remaining: number };
export type LimitErr = { ok: false; retryAfterSec: number };
export type LimitResult = LimitOk | LimitErr;

/** In-memory sliding window limiter (per process / Vercel instance). */
export class MemoryWindowLimiter {
  private buckets = new Map<string, number[]>();
  private getMax: () => number;
  private getWindowMs: () => number;
  private now: () => number;

  constructor(
    getMax: () => number,
    getWindowMs: () => number,
    now: () => number = Date.now,
  ) {
    this.getMax = getMax;
    this.getWindowMs = getWindowMs;
    this.now = now;
  }

  attempt(key: string): LimitResult {
    const now = this.now();
    const windowMs = this.getWindowMs();
    const max = this.getMax();
    const cutoff = now - windowMs;
    const times = (this.buckets.get(key) ?? []).filter((t) => t > cutoff);
    if (times.length >= max) {
      const oldest = times[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      this.buckets.set(key, times);
      return { ok: false, retryAfterSec };
    }
    times.push(now);
    this.buckets.set(key, times);
    return { ok: true, remaining: Math.max(0, max - times.length) };
  }

  reset() {
    this.buckets.clear();
  }
}

const defaultLimiter = new MemoryWindowLimiter(
  () => getServerTestKeyMaxCalls(),
  () => getServerTestKeyWindowMs(),
);

/** Test helper — clears the process-wide in-memory limiter. */
export function resetServerTestKeyLimiter() {
  defaultLimiter.reset();
}

export type ServerTestKeyAccess =
  | { ok: true }
  | { ok: false; status: 403 | 429; error: string; retryAfter?: number };

export function checkServerTestKeyAccess(
  request: Request,
  opts?: {
    enabled?: boolean;
    limiter?: MemoryWindowLimiter;
    ip?: string;
  },
): ServerTestKeyAccess {
  const enabled = opts?.enabled ?? isServerTestKeyEnabled();
  if (!enabled) {
    return { ok: false, status: 403, error: SERVER_KEY_DISABLED_MESSAGE };
  }

  const ip = opts?.ip ?? getClientIp(request);
  const limiter = opts?.limiter ?? defaultLimiter;
  const result = limiter.attempt(`stk:${ip}`);
  if (!result.ok) {
    return {
      ok: false,
      status: 429,
      error:
        "Server test key rate limit reached. Try again later, or use your own OpenAI API key.",
      retryAfter: result.retryAfterSec,
    };
  }
  return { ok: true };
}
