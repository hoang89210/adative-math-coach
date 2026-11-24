import { NextRequest, NextResponse } from "next/server";
import { listLabArtifacts } from "@/lib/lab/artifacts";

export async function GET(request: NextRequest) {
  try {
    const session =
      request.nextUrl.searchParams.get("sessionId") ||
      request.nextUrl.searchParams.get("code") ||
      "";
    if (!session.trim()) {
      return NextResponse.json(
        { error: "sessionId or code is required" },
        { status: 400 },
      );
    }
    const data = await listLabArtifacts(session);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}
