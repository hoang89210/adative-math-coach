import { NextRequest, NextResponse } from "next/server";
import { HttpError, errorResponse, readJsonBody } from "@/lib/api-errors";
import { loadLearnerById } from "@/lib/learners";
import { posteriorsFromTallies, type BetaParams } from "@/lib/lc-mastery";
import { buildLcMasteryReport } from "@/lib/lc-mastery-report";
import { isValidLearnerId, loadLcMastery } from "@/lib/lc-mastery-store";
import { logError } from "@/lib/log-safe";
import { verifyLearnerToken } from "@/lib/learner-token";
import { isValidSessionRef, loadMastery, resolveSessionId } from "@/lib/mastery";

export const maxDuration = 30;

/**
 * POST /api/mastery
 *   { learnerId, learnerToken } -> learner's cumulative LC mastery (/progress);
 *                               token from /api/learners create/login
 *   { sessionId | code }     -> mastery for that session (/results, /teacher):
 *                               the linked learner's cumulative posteriors when
 *                               the session belongs to a learner, else the
 *                               session's own diagnostic evidence.
 * POST (not GET) so learnerId never lands in URLs / access logs.
 * Statistics only (Beta posteriors); never calls an LLM or evaluator.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await readJsonBody(request, 8 * 1024)) as {
      learnerId?: unknown;
      learnerToken?: unknown;
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
    let grade: string | undefined;

    if (body.learnerId !== undefined && body.learnerId !== null && body.learnerId !== "") {
      if (!isValidLearnerId(body.learnerId)) {
        return NextResponse.json({ error: "invalid learnerId" }, { status: 400 });
      }
      const learnerId = body.learnerId.trim();
      // a bare learnerId is not enough to read cumulative mastery
      const check = verifyLearnerToken(learnerId, body.learnerToken);
      if (!check.ok) {
        return NextResponse.json(
          {
            error: "Please sign in again with your learner code and PIN.",
            reason: check.reason,
          },
          { status: 401 },
        );
      }
      const loaded = await loadLcMastery(learnerId);
      posteriors = loaded.posteriors;
      store = loaded.source;
      // grade / jurisdiction steer the primary-standard choice; best effort
      try {
        const learner = await loadLearnerById(learnerId);
        grade = learner?.currentGrade;
        jurisdiction = jurisdiction || learner?.jurisdiction;
      } catch (err) {
        logError("mastery: learner profile load failed", err);
      }
    } else {
      const raw = String(body.sessionId ?? body.code ?? "").trim().slice(0, 64);
      if (!raw) {
        return NextResponse.json({ error: "learnerId, sessionId or code is required" }, { status: 400 });
      }
      if (!isValidSessionRef(raw)) {
        return NextResponse.json(
          { error: "session not found — invalid code format (use the 8-character code or full session id)" },
          { status: 400 },
        );
      }
      // DB unavailable -> throws -> 503 + Retry-After (not a fake 404)
      sessionId = await resolveSessionId(raw);
      const session = sessionId ? await loadMastery(sessionId) : null;
      if (!session) {
        return NextResponse.json({ error: "session not found" }, { status: 404 });
      }
      jurisdiction = jurisdiction || session.jurisdiction;
      grade = session.grade;
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

    const report = buildLcMasteryReport(posteriors, jurisdiction, grade);
    return NextResponse.json({
      mode,
      store,
      persisted: store === "db",
      sessionId,
      ...report,
    });
  } catch (err) {
    if (!(err instanceof HttpError)) logError("mastery report failed", err);
    return errorResponse(err, { fallbackMessage: "Mastery report failed" });
  }
}
