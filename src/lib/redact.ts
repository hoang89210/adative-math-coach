/** Best-effort redaction so API keys, tokens, and URI passwords never appear in logs or client errors. */

const ENV_SECRET_NAMES = [
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

const KEY_RE = /sk-(?:proj-|or-)?[A-Za-z0-9_\-/*]{4,}/gi;
const BEARER_RE = /Bearer\s+\S+/gi;
const URI_CRED_RE = /:\/\/([^:/?#@]+):([^@/?#]+)@/g;

export function redactSecrets(input: string): string {
  let out = input;
  for (const name of ENV_SECRET_NAMES) {
    const value = process.env[name]?.trim();
    if (value && value.length >= 8) {
      out = out.split(value).join("[redacted]");
    }
  }
  out = out.replace(URI_CRED_RE, "://$1:[redacted]@");
  out = out.replace(BEARER_RE, "Bearer [redacted]");
  out = out.replace(KEY_RE, "sk-[redacted]");
  return out;
}

export function redactForLog(value: unknown): string {
  if (value instanceof Error) {
    return redactSecrets(`${value.name}: ${value.message}`);
  }
  if (typeof value === "string") return redactSecrets(value);
  try {
    return redactSecrets(JSON.stringify(value) ?? String(value));
  } catch {
    return redactSecrets(String(value));
  }
}

export function publicErrorMessage(
  err: unknown,
  fallback = "Internal error",
): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactSecrets(raw).trim() || fallback;
}
