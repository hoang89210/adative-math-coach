export function sessionShortCode(sessionId: string) {
  return sessionId.replace(/-/g, "").slice(0, 8).toUpperCase();
}
