/**
 * Pure PIN-login rate-limit math (no I/O).
 * Shared by the Postgres-backed limiter and the in-memory fallback.
 *
 * Two layers share the same window and store, with different keys:
 *   - IP + learner code: 5 failures / 15 min (PIN_LOGIN_MAX_FAILURES)
 *   - learner code only: 10 failures / 15 min from any IP (PIN_CODE_MAX_FAILURES)
 */

export const PIN_LOGIN_MAX_FAILURES = 5;
export const PIN_CODE_MAX_FAILURES = 10;
export const PIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;

export type PinRateLimitResult = {
  limited: boolean;
  remaining: number;
  retryAfterSec: number;
};

export function normalizeLearnerCode(code: string) {
  return code.trim().toUpperCase();
}

export function normalizeIp(ip: string) {
  const trimmed = ip.trim();
  if (trimmed.startsWith("::ffff:")) return trimmed.slice(7);
  return trimmed || "unknown";
}

export function pinLoginRateKey(ip: string, learnerCode: string) {
  return `pin-login:${normalizeIp(ip)}:${normalizeLearnerCode(learnerCode)}`;
}

/** Per-code bucket (any IP). */
export function pinLoginCodeRateKey(learnerCode: string) {
  return `pin-login-code:${normalizeLearnerCode(learnerCode)}`;
}

/**
 * Client IP for rate limiting. Prefer platform-trusted headers:
 * `x-vercel-forwarded-for`, then `x-real-ip`. Fall back to the *last*
 * hop of `x-forwarded-for` (the address the proxy actually saw). The first
 * XFF hop is client-controlled and must not be trusted.
 */
export function getClientIp(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const hop = vercel.split(",")[0]?.trim();
    if (hop) return normalizeIp(hop);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return normalizeIp(real);
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return normalizeIp(last);
  }
  return "unknown";
}

export type MemoryEntry = { count: number; windowStart: number };

export function toRateLimitResult(
  failCount: number,
  windowStartMs: number,
  now: number,
  maxFailures: number = PIN_LOGIN_MAX_FAILURES,
): PinRateLimitResult {
  if (now - windowStartMs >= PIN_LOGIN_WINDOW_MS) {
    return {
      limited: false,
      remaining: maxFailures,
      retryAfterSec: 0,
    };
  }
  const limited = failCount >= maxFailures;
  return {
    limited,
    remaining: Math.max(0, maxFailures - failCount),
    retryAfterSec: limited
      ? Math.max(1, Math.ceil((windowStartMs + PIN_LOGIN_WINDOW_MS - now) / 1000))
      : 0,
  };
}

export function combineRateLimitResults(
  ...results: PinRateLimitResult[]
): PinRateLimitResult {
  if (results.length === 0) {
    return {
      limited: false,
      remaining: PIN_LOGIN_MAX_FAILURES,
      retryAfterSec: 0,
    };
  }
  const limited = results.some((result) => result.limited);
  return {
    limited,
    remaining: Math.min(...results.map((result) => result.remaining)),
    retryAfterSec: limited
      ? Math.max(...results.map((result) => result.retryAfterSec))
      : 0,
  };
}

export function inspectMemoryRateLimit(
  store: Map<string, MemoryEntry>,
  key: string,
  now = Date.now(),
  maxFailures: number = PIN_LOGIN_MAX_FAILURES,
): PinRateLimitResult {
  const entry = store.get(key);
  if (!entry) return toRateLimitResult(0, now, now, maxFailures);
  return toRateLimitResult(entry.count, entry.windowStart, now, maxFailures);
}

export function recordMemoryFailure(
  store: Map<string, MemoryEntry>,
  key: string,
  now = Date.now(),
  maxFailures: number = PIN_LOGIN_MAX_FAILURES,
): PinRateLimitResult {
  const existing = store.get(key);
  if (!existing || now - existing.windowStart >= PIN_LOGIN_WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
  } else {
    store.set(key, {
      count: existing.count + 1,
      windowStart: existing.windowStart,
    });
  }
  return inspectMemoryRateLimit(store, key, now, maxFailures);
}

export function clearMemoryFailures(
  store: Map<string, MemoryEntry>,
  key: string,
) {
  store.delete(key);
}

/**
 * Login decision used by the route (and unit tests): check both layers
 * *before* verifying the PIN. A correct PIN during lockout still 429s
 * and does not clear either bucket.
 */
export function decidePinLogin(
  store: Map<string, MemoryEntry>,
  ip: string,
  code: string,
  now: number,
  pinIsCorrect: boolean,
): { status: "ok" | "401" | "429"; retryAfterSec: number } {
  const ipKey = pinLoginRateKey(ip, code);
  const codeKey = pinLoginCodeRateKey(code);
  const before = combineRateLimitResults(
    inspectMemoryRateLimit(store, ipKey, now, PIN_LOGIN_MAX_FAILURES),
    inspectMemoryRateLimit(store, codeKey, now, PIN_CODE_MAX_FAILURES),
  );
  if (before.limited) {
    return { status: "429", retryAfterSec: before.retryAfterSec };
  }
  if (!pinIsCorrect) {
    recordMemoryFailure(store, ipKey, now, PIN_LOGIN_MAX_FAILURES);
    recordMemoryFailure(store, codeKey, now, PIN_CODE_MAX_FAILURES);
    const after = combineRateLimitResults(
      inspectMemoryRateLimit(store, ipKey, now, PIN_LOGIN_MAX_FAILURES),
      inspectMemoryRateLimit(store, codeKey, now, PIN_CODE_MAX_FAILURES),
    );
    if (after.limited) {
      return { status: "429", retryAfterSec: after.retryAfterSec };
    }
    return { status: "401", retryAfterSec: 0 };
  }
  clearMemoryFailures(store, ipKey);
  clearMemoryFailures(store, codeKey);
  return { status: "ok", retryAfterSec: 0 };
}
