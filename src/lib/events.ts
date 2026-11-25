import { dbEnabled, dbQuery } from "@/lib/db/client";

export type AmcEvent = {
  kind: string;
  sessionId?: string | null;
  learnerId?: string | null;
  grade?: string | null;
  ok?: boolean;
  message?: string | null;
  meta?: Record<string, unknown> | null;
};

/** Best-effort event log — never throws to callers. Never log API keys. */
export async function logEvent(event: AmcEvent) {
  if (!dbEnabled()) return;
  try {
    const meta = event.meta ? scrubMeta(event.meta) : null;
    await dbQuery(
      `insert into amc_events (kind, session_id, learner_id, grade, ok, message, meta)
       values ($1, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb)`,
      [
        event.kind,
        event.sessionId || null,
        event.learnerId || null,
        event.grade || null,
        event.ok !== false,
        event.message || null,
        meta ? JSON.stringify(meta) : null,
      ],
    );
  } catch (err) {
    console.error("amc_events insert failed", err instanceof Error ? err.message : err);
  }
}

function scrubMeta(meta: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const key = k.toLowerCase();
    if (
      key.includes("key") ||
      key.includes("token") ||
      key.includes("password") ||
      key.includes("authorization") ||
      key.includes("pin")
    ) {
      continue;
    }
    if (typeof v === "string" && v.startsWith("sk-")) continue;
    out[k] = v;
  }
  return out;
}
