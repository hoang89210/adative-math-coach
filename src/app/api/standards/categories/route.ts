import { NextRequest, NextResponse } from "next/server";
import {
  getDomainsForGrade,
  listJurisdictions,
} from "@/lib/standards/catalog";

export async function GET(request: NextRequest) {
  try {
    const grade = request.nextUrl.searchParams.get("grade") ?? "";
    const jurisdiction =
      request.nextUrl.searchParams.get("jurisdiction") ?? undefined;
    if (!grade) {
      return NextResponse.json({ error: "grade is required" }, { status: 400 });
    }
    const domains = getDomainsForGrade(grade, jurisdiction || undefined);
    return NextResponse.json({
      grade,
      jurisdiction: jurisdiction || "Multi-State",
      jurisdictions: listJurisdictions(),
      domains,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
