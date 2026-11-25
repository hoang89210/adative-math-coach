/**
 * Sanitize a database / driver error for API responses and logs.
 * Strips connection URIs, credentials, tokens, and other secrets.
 * Returns a short message, preferably "code: generic text".
 */
const MAX_LENGTH = 180;

const SECRET_PATTERNS: RegExp[] = [
  // postgres://user:pass@host:5432/db?password=...
  /[a-z][a-z0-9+.-]*:\/\/[^\s'"\\]+/gi,
  // password=secret, token: abc, api_key=...
  /(?:password|passwd|pwd|pass|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
  // POSTGRES_URL=..., DATABASE_URL=...
  /\b(?:POSTGRES|DATABASE|SUPABASE)_[A-Z0-9_]*=\S+/gi,
  // query-string credential fragments if a URI was split
  /[?&](?:password|passwd|pwd|user|username|token|apikey|api[_-]?key|sslmode)=[^&\s]*/gi,
  // OpenAI-style keys, including masked forms like sk-TESTL****...A111
  /\bsk-[A-Za-z0-9_\-*.]+/g,
  // user:pass@host (URI without scheme)
  /\b[^\s/@:]+:[^@\s]+@[^\s]+/g,
];

function extractCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (code != null && String(code).trim()) return String(code).trim();
  }
  return "";
}

function rawMessage(err: unknown): string {
  if (err instanceof Error) {
    const parts = [err.message];
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) parts.push(cause.message);
    else if (typeof cause === "string") parts.push(cause);
    return parts.join(" — ");
  }
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message ?? "");
  }
  if (typeof err === "string") return err;
  return "";
}

export function sanitizeDbError(err: unknown): string {
  const code = extractCode(err);
  let message = rawMessage(err);
  for (const pattern of SECRET_PATTERNS) {
    message = message.replace(pattern, "[redacted]");
  }
  message = message.replace(/\s+/g, " ").trim();
  if (!message) message = "database check failed";
  if (message.length > MAX_LENGTH) {
    message = `${message.slice(0, MAX_LENGTH)}…`;
  }
  return code ? `${code}: ${message}` : message;
}
