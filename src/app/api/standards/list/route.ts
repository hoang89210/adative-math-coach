import { NextRequest, NextResponse } from "next/server";
import { listStandards } from "@/lib/standards/catalog";

export async function GET(request: NextRequest) {
  try {
    const grade = request.nextUrl.searchParams.get("grade") ?? "";
    const domain = request.nextUrl.searchParams.get("domain") ?? undefined;
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "80");
    if (!grade) {
      return NextResponse.json({ error: "grade is required" }, { status: 400 });
    }
    const standards = listStandards({
      grade,
      domain: domain || undefined,
      q,
      limit: Number.isFinite(limit) ? limit : 80,
    });
    return NextResponse.json({
      grade,
      domain: domain ?? null,
      count: standards.length,
      standards,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
