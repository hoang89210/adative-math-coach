/**
 * Redact secrets before anything is written to logs or event meta.
 * The request header `x-openai-api-key` (user-pasted OpenAI key) must never
 * appear in console output, error reports, or stored events.
 */

const REDACTED = "[redacted]";

/**
 * OpenAI-style secrets, including provider-masked forms such as
 * `sk-TESTL****...A111` and `sk-proj-ABCD****...Z999`.
 * Also matches full `sk-` / `sk-proj-` / `sk-svcacct-` keys.
 * Dots and asterisks are part of the key token so a mask suffix cannot leak.
 */
const API_KEY_PATTERN = /\bsk-[A-Za-z0-9_\-*.]+/g;

const URI_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s'"\\]+/gi;

const SENSITIVE_HEADER =
  /^(x-openai-api-key|authorization|cookie|set-cookie|proxy-authorization|x-api-key)$/i;

const SENSITIVE_KEY =
  /(x-openai-api-key|authorization|api[_-]?key|token|password|passwd|secret|cookie|pin)/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_HEADER.test(key) || SENSITIVE_KEY.test(key);
}

export function redactSecretString(value: string): string {
  return value
    .replace(API_KEY_PATTERN, REDACTED)
    .replace(URI_PATTERN, REDACTED);
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
    out[key] = isSensitiveKey(key)
      ? REDACTED
      : redactSecretString(String(value ?? ""));
  }
  return out;
}

function isErrorLike(value: unknown): value is Error {
  return (
    value instanceof Error ||
    Object.prototype.toString.call(value) === "[object Error]"
  );
}

function redactError(err: Error, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: err.name || "Error",
    message: redactSecretString(err.message),
  };
  if (typeof err.stack === "string") {
    out.stack = redactSecretString(err.stack);
  }
  if ("code" in err && (err as { code?: unknown }).code != null) {
    out.code = (err as { code?: unknown }).code;
  }
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause !== undefined) {
    out.cause = redactForLog(cause, depth + 1);
  }
  return out;
}

export function redactForLog(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") return redactSecretString(value);
  if (depth > 4) return REDACTED;
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return redactHeaders(value);
  }
  if (isErrorLike(value)) {
    return redactError(value, depth);
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
 * Safe console.error. Pass a message and/or an Error / log payload.
 * Error.message, stack, and cause are redacted so masked `sk-` fragments
 * cannot leak when someone logs the Error object directly.
 */
export function logError(messageOrErr: unknown, detail?: unknown) {
  const first = redactForLog(messageOrErr);
  if (detail === undefined) {
    console.error(first);
    return;
  }
  console.error(first, redactForLog(detail));
}
