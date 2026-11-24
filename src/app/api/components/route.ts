import { NextRequest, NextResponse } from "next/server";
import { getLearningComponentsByGrade } from "@/lib/data/learning-components";

export async function GET(request: NextRequest) {
  const grade = request.nextUrl.searchParams.get("grade") ?? "";

  try {
    const components = await getLearningComponentsByGrade(grade);
    return NextResponse.json({
      grade,
      count: components.length,
      components,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        grade,
        count: 0,
        components: [],
      },
      { status: 500 },
    );
  }
}
