import { getClientIp } from "./pin-rate-limit-core";

/** Client header that requests server-key (test) mode. Server still decides. */
export const SERVER_TEST_KEY_HEADER = "x-use-server-key";

/** Returned when a request has no user key and is not authorized to use the server key. */
export const OPENAI_KEY_REQUIRED = "OPENAI_KEY_REQUIRED";

const DEFAULT_MAX_CALLS = 20;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export function parseTruthyEnvFlag(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function parseAllowServerTestKeyFlag(
  value: string | undefined = process.env.ALLOW_SERVER_TEST_KEY,
): boolean {
  return parseTruthyEnvFlag(value);
}

/** Silent env-key fallback (no x-use-server-key header). Off by default. */
export function parseAllowServerKeyFallbackFlag(
  value: string | undefined = process.env.ALLOW_SERVER_KEY_FALLBACK,
): boolean {
  return parseTruthyEnvFlag(value);
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

/** True only when ALLOW_SERVER_KEY_FALLBACK is on AND the server has OPENAI_API_KEY. */
export function isServerKeyFallbackEnabled(
  flag: boolean = parseAllowServerKeyFallbackFlag(),
  hasServerKey: boolean = Boolean(process.env.OPENAI_API_KEY?.trim()),
): boolean {
  return flag && hasServerKey;
}

export function missingOpenAiKeyError(serverTestKeyEnabled: boolean): {
  ok: false;
  status: 401;
  code: typeof OPENAI_KEY_REQUIRED;
  error: string;
  serverTestKeyEnabled: boolean;
} {
  return {
    ok: false,
    status: 401,
    code: OPENAI_KEY_REQUIRED,
    error: serverTestKeyEnabled
      ? "OpenAI API key required. Paste your key in the yellow panel, or click “Không có key” to use the server test key."
      : "OpenAI API key required. Paste your key in the yellow panel.",
    serverTestKeyEnabled,
  };
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
  allowServerKeyFallback?: boolean;
  serverKey?: string;
  userKey?: string;
  serverTestKeyEnabled?: boolean;
};

export type KeySelectOk = {
  ok: true;
  source: "server" | "user" | "fallback";
  key: string;
};

export type KeySelectErr = {
  ok: false;
  status: 401 | 403;
  error: string;
  code?: string;
  serverTestKeyEnabled?: boolean;
};

export type KeySelectResult = KeySelectOk | KeySelectErr;

const SERVER_KEY_DISABLED_MESSAGE =
  "Server test key is not enabled. Paste your own OpenAI API key, or ask an admin to set ALLOW_SERVER_TEST_KEY=1 with OPENAI_API_KEY.";

/**
 * Pick which API key to use.
 * The server key is used only when useServerKey is set (button header already
 * authorized, or the optional fallback flag authorized). It is never used as a
 * silent default when the client sends no key.
 */
export function selectLlmApiKey(input: KeySelectInput): KeySelectResult {
  if (input.useServerKey) {
    const serverKey = input.serverKey?.trim() ?? "";
    if (!serverKey || !(input.allowServerTestKey || input.allowServerKeyFallback)) {
      return { ok: false, status: 403, error: SERVER_KEY_DISABLED_MESSAGE };
    }
    return {
      ok: true,
      source: input.allowServerTestKey ? "server" : "fallback",
      key: serverKey,
    };
  }

  const userKey = input.userKey?.trim();
  if (userKey) return { ok: true, source: "user", key: userKey };

  if (input.allowServerKeyFallback) {
    const serverKey = input.serverKey?.trim() ?? "";
    if (serverKey) return { ok: true, source: "fallback", key: serverKey };
  }

  const missing = missingOpenAiKeyError(Boolean(input.serverTestKeyEnabled));
  return {
    ok: false,
    status: missing.status,
    error: missing.error,
    code: missing.code,
    serverTestKeyEnabled: missing.serverTestKeyEnabled,
  };
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

export type LlmRequestAccess =
  | { ok: true; useServerKey: boolean; apiKey?: string }
  | {
      ok: false;
      status: 401 | 403 | 429;
      error: string;
      code?: string;
      retryAfter?: number;
      serverTestKeyEnabled?: boolean;
    };

/**
 * Decide how this request may use a key. The server key is used only with
 * `x-use-server-key: 1` + ALLOW_SERVER_TEST_KEY, or (if enabled) the
 * ALLOW_SERVER_KEY_FALLBACK path. Both paths always go through the limiter.
 */
export function resolveLlmRequestAccess(
  request: Request,
  userKey: string | undefined,
  opts?: {
    testKeyEnabled?: boolean;
    fallbackEnabled?: boolean;
    limiter?: MemoryWindowLimiter;
    ip?: string;
  },
): LlmRequestAccess {
  const testKeyEnabled = opts?.testKeyEnabled ?? isServerTestKeyEnabled();
  const fallbackEnabled = opts?.fallbackEnabled ?? isServerKeyFallbackEnabled();
  const limitOpts = {
    limiter: opts?.limiter,
    ip: opts?.ip,
  };

  if (wantsServerTestKey(request)) {
    const access = checkServerTestKeyAccess(request, {
      enabled: testKeyEnabled,
      ...limitOpts,
    });
    if (!access.ok) return access;
    return { ok: true, useServerKey: true };
  }

  if (userKey?.trim()) {
    return { ok: true, useServerKey: false, apiKey: userKey.trim() };
  }

  if (fallbackEnabled) {
    const access = checkServerTestKeyAccess(request, {
      enabled: true,
      ...limitOpts,
    });
    if (!access.ok) return access;
    return { ok: true, useServerKey: true };
  }

  return missingOpenAiKeyError(testKeyEnabled);
}

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
