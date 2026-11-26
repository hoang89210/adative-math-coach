import { NextRequest, NextResponse } from "next/server";
import { HttpError, errorResponse, readJsonBody } from "@/lib/api-errors";
import {
  createLearner,
  findLearnerByCode,
  publicLearnerView,
  verifyLearnerPin,
} from "@/lib/learners";
import { dbFailFastResponseInit, isDbTimeoutError } from "@/lib/db/client";
import { sanitizeDbError } from "@/lib/sanitize-error";
import { issueLearnerToken } from "@/lib/learner-token";
import {
  checkPinLoginLimits,
  clearPinLoginFailures,
  getClientIp,
  recordPinLoginFailure,
} from "@/lib/pin-rate-limit";

function rateLimitResponse(retryAfterSec: number) {
  return NextResponse.json(
    { error: "Too many login attempts. Try again later." },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await readJsonBody(request)) as {
      action?: "create" | "login" | "lookup";
      pin?: string;
      code?: string;
      grade?: string;
      jurisdiction?: string;
    };
    const action = body.action ?? "create";

    if (action === "create") {
      const { profile, pin } = await createLearner({
        pin: String(body.pin ?? ""),
        grade: body.grade,
        jurisdiction: body.jurisdiction,
      });
      return NextResponse.json({
        learnerId: profile.id,
        learnerToken: issueLearnerToken(profile.id),
        publicCode: profile.publicCode,
        pin,
        view: publicLearnerView(profile),
      });
    }

    if (action === "login") {
      const code = String(body.code ?? "");
      const ip = getClientIp(request);
      const limit = await checkPinLoginLimits(ip, code);
      if (limit.limited) {
        return rateLimitResponse(limit.retryAfterSec);
      }

      const profile = await verifyLearnerPin(code, String(body.pin ?? ""));
      if (!profile) {
        await recordPinLoginFailure(ip, code);
        const after = await checkPinLoginLimits(ip, code);
        if (after.limited) {
          return rateLimitResponse(after.retryAfterSec);
        }
        return NextResponse.json(
          { error: "Invalid code or PIN" },
          { status: 401 },
        );
      }
      await clearPinLoginFailures(ip, code);
      return NextResponse.json({
        learnerId: profile.id,
        learnerToken: issueLearnerToken(profile.id),
        publicCode: profile.publicCode,
        view: publicLearnerView(profile),
      });
    }

    if (action === "lookup") {
      const profile = await findLearnerByCode(String(body.code ?? ""));
      if (!profile) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({
        publicCode: profile.publicCode,
        view: publicLearnerView(profile),
      });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    if (isDbTimeoutError(err)) {
      return NextResponse.json(
        { error: sanitizeDbError(err) || "Request failed" },
        dbFailFastResponseInit(),
      );
    }
    return NextResponse.json(
      { error: sanitizeDbError(err) || "Request failed" },
      { status: 500 },
    );
  }
}
