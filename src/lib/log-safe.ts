/**
 * Redact secrets before anything is written to logs or event meta.
 * The request header `x-openai-api-key` (user-pasted OpenAI key) must never
 * appear in console output, error reports, or stored events.
 */

const REDACTED = "[redacted]";

const SENSITIVE_HEADER =
  /^(x-openai-api-key|authorization|cookie|set-cookie|proxy-authorization|x-api-key)$/i;

const SENSITIVE_KEY =
  /(x-openai-api-key|authorization|api[_-]?key|token|password|passwd|secret|cookie|pin)/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_HEADER.test(key) || SENSITIVE_KEY.test(key);
}

function redactString(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"\\]+/gi, REDACTED);
}

function entriesFromHeaders(
  headers: Headers | Record<string, unknown> | Iterable<[string, string]>,
): Array<[string, string]> {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return Array.from(headers.entries());
  }
  if (headers && typeof headers === "object" && !Array.isArray(headers)) {
    return Object.entries(headers as Record<string, unknown>)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(", ") : String(value),
      ]);
  }
  return Array.from(headers as Iterable<[string, string]>);
}

export function redactHeaders(
  headers: Headers | Record<string, unknown> | Iterable<[string, string]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of entriesFromHeaders(headers)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactString(String(value ?? ""));
  }
  return out;
}

export function redactForLog(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") return redactString(value);
  if (depth > 4) return REDACTED;
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return redactHeaders(value);
  }
  if (Array.isArray(value)) return value.map((item) => redactForLog(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactForLog(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Drop or redact secret-bearing fields from event / log metadata. */
export function scrubMeta(
  meta: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (isSensitiveKey(key)) continue;
    if (typeof value === "string" && value.startsWith("sk-")) continue;
    out[key] = redactForLog(value);
  }
  return out;
}

/**
 * Safe console helpers — use these if logging request-adjacent data.
 * Never pass raw Headers / Request without going through redactHeaders.
 */
export function logError(message: string, detail?: unknown) {
  if (detail === undefined) {
    console.error(message);
    return;
  }
  console.error(message, redactForLog(detail));
}
