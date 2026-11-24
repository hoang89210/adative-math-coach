import { NextRequest, NextResponse } from "next/server";
import { getDomainsForGrade } from "@/lib/standards/catalog";

export async function GET(request: NextRequest) {
  try {
    const grade = request.nextUrl.searchParams.get("grade") ?? "";
    if (!grade) {
      return NextResponse.json({ error: "grade is required" }, { status: 400 });
    }
    const domains = getDomainsForGrade(grade);
    return NextResponse.json({ grade, domains });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
