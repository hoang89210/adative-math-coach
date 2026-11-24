import { NextRequest, NextResponse } from "next/server";
import { loadMastery, resolveSessionId } from "@/lib/mastery";

export async function GET(request: NextRequest) {
  try {
    const sessionId = await resolveSessionId(
      request.nextUrl.searchParams.get("sessionId") ||
        request.nextUrl.searchParams.get("code") ||
        "",
    );
    if (!sessionId) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    const session = await loadMastery(sessionId);
    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    return NextResponse.json({
      sessionId,
      grade: session.grade,
      jurisdiction: session.jurisdiction,
      coverage: session.coverage ?? null,
      percent: session.result.percent,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
