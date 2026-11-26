import { NextRequest, NextResponse } from "next/server";
import { dbFailFastResponseInit, isDbTimeoutError } from "@/lib/db/client";
import { posteriorsFromTallies, type BetaParams } from "@/lib/lc-mastery";
import { buildLcMasteryReport } from "@/lib/lc-mastery-report";
import { isValidLearnerId, loadLcMastery } from "@/lib/lc-mastery-store";
import { logError } from "@/lib/log-safe";
import { loadMastery, resolveSessionId } from "@/lib/mastery";
import { sanitizeDbError } from "@/lib/sanitize-error";

export const maxDuration = 30;

/**
 * POST /api/mastery
 *   { learnerId }            -> learner's cumulative LC mastery (/progress)
 *   { sessionId | code }     -> mastery for that session (/results, /teacher):
 *                               the linked learner's cumulative posteriors when
 *                               the session belongs to a learner, else the
 *                               session's own diagnostic evidence.
 * POST (not GET) so learnerId never lands in URLs / access logs.
 * Statistics only (Beta posteriors); never calls an LLM or evaluator.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      learnerId?: unknown;
      sessionId?: unknown;
      code?: unknown;
      jurisdiction?: unknown;
    };
    let jurisdiction =
      typeof body.jurisdiction === "string" ? body.jurisdiction.trim().slice(0, 60) : undefined;

    let posteriors = new Map<string, BetaParams>();
    let mode: "learner" | "session" = "learner";
    let store: "db" | "memory" | "session" = "session";
    let sessionId: string | null = null;

    if (body.learnerId !== undefined && body.learnerId !== null && body.learnerId !== "") {
      if (!isValidLearnerId(body.learnerId)) {
        return NextResponse.json({ error: "invalid learnerId" }, { status: 400 });
      }
      const loaded = await loadLcMastery(body.learnerId.trim());
      posteriors = loaded.posteriors;
      store = loaded.source;
    } else {
      const raw = String(body.sessionId ?? body.code ?? "").trim().slice(0, 64);
      if (!raw) {
        return NextResponse.json({ error: "learnerId, sessionId or code is required" }, { status: 400 });
      }
      sessionId = await resolveSessionId(raw);
      const session = sessionId ? await loadMastery(sessionId) : null;
      if (!session) {
        return NextResponse.json({ error: "session not found" }, { status: 404 });
      }
      jurisdiction = jurisdiction || session.jurisdiction;
      if (session.learnerId && isValidLearnerId(session.learnerId)) {
        const loaded = await loadLcMastery(session.learnerId);
        posteriors = loaded.posteriors;
        store = loaded.source;
        mode = "learner";
      }
      if (posteriors.size === 0) {
        posteriors = posteriorsFromTallies(session.result.byComponent);
        store = "session";
        mode = "session";
      }
    }

    const report = buildLcMasteryReport(posteriors, jurisdiction);
    return NextResponse.json({
      mode,
      store,
      persisted: store === "db",
      sessionId,
      ...report,
    });
  } catch (err) {
    if (isDbTimeoutError(err)) {
      return NextResponse.json(
        { error: sanitizeDbError(err) || "Database temporarily unavailable" },
        dbFailFastResponseInit(),
      );
    }
    logError("mastery report failed", err);
    return NextResponse.json({ error: "Mastery report failed" }, { status: 500 });
  }
}
