import { NextRequest, NextResponse } from "next/server";
import {
  getCachedTeacherLesson,
  resolveSessionId,
} from "@/lib/mastery";

export async function GET(request: NextRequest) {
  try {
    const sessionId = await resolveSessionId(
      request.nextUrl.searchParams.get("sessionId") || "",
    );
    const componentId = (
      request.nextUrl.searchParams.get("componentId") || ""
    ).trim();
    if (!sessionId || !componentId) {
      return NextResponse.json(
        { error: "sessionId and componentId required" },
        { status: 400 },
      );
    }

    const lesson = await getCachedTeacherLesson(sessionId, componentId);
    if (!lesson) {
      return NextResponse.json(
        { error: "lesson not found — generate first" },
        { status: 404 },
      );
    }

    const slug = lesson.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    return new NextResponse(lesson.markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="lesson-${slug || "math"}.md"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
