export function sessionShortCode(sessionId: string) {
  return sessionId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionUuid(id: string) {
  return UUID_RE.test(id);
}

/**
 * Session reference accepted by lookups: a full session UUID (with or
 * without dashes) or a short code = at least the first 8 hex chars.
 * Anything else (e.g. "ZZZZZZZZ") is rejected before touching the DB.
 */
export function isValidSessionRef(input: string): boolean {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > 64) return false;
  if (UUID_RE.test(raw)) return true;
  const compact = raw.replace(/-/g, "");
  return /^[0-9a-f]{8,32}$/i.test(compact);
}
