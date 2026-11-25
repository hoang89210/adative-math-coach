/**
 * Pure PIN-login rate-limit math (no I/O).
 * Shared by the Postgres-backed limiter and the in-memory fallback.
 */

export const PIN_LOGIN_MAX_FAILURES = 5;
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
): PinRateLimitResult {
  if (now - windowStartMs >= PIN_LOGIN_WINDOW_MS) {
    return {
      limited: false,
      remaining: PIN_LOGIN_MAX_FAILURES,
      retryAfterSec: 0,
    };
  }
  const limited = failCount >= PIN_LOGIN_MAX_FAILURES;
  return {
    limited,
    remaining: Math.max(0, PIN_LOGIN_MAX_FAILURES - failCount),
    retryAfterSec: limited
      ? Math.max(1, Math.ceil((windowStartMs + PIN_LOGIN_WINDOW_MS - now) / 1000))
      : 0,
  };
}

export function inspectMemoryRateLimit(
  store: Map<string, MemoryEntry>,
  key: string,
  now = Date.now(),
): PinRateLimitResult {
  const entry = store.get(key);
  if (!entry) return toRateLimitResult(0, now, now);
  return toRateLimitResult(entry.count, entry.windowStart, now);
}

export function recordMemoryFailure(
  store: Map<string, MemoryEntry>,
  key: string,
  now = Date.now(),
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
  return inspectMemoryRateLimit(store, key, now);
}

export function clearMemoryFailures(
  store: Map<string, MemoryEntry>,
  key: string,
) {
  store.delete(key);
}
