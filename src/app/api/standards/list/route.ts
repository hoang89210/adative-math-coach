import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-errors";
import { listStandards } from "@/lib/standards/catalog";

export async function GET(request: NextRequest) {
  try {
    const grade = request.nextUrl.searchParams.get("grade") ?? "";
    const domain = request.nextUrl.searchParams.get("domain") ?? undefined;
    const jurisdiction =
      request.nextUrl.searchParams.get("jurisdiction") ?? undefined;
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "80");
    if (!grade) {
      return NextResponse.json({ error: "grade is required" }, { status: 400 });
    }
    const standards = listStandards({
      grade,
      domain: domain || undefined,
      jurisdiction: jurisdiction || undefined,
      q,
      limit: Number.isFinite(limit) ? limit : 80,
    });
    return NextResponse.json({
      grade,
      domain: domain ?? null,
      jurisdiction: jurisdiction ?? null,
      count: standards.length,
      standards,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
