import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-errors";
import {
  isValidSessionRef,
  loadMastery,
  resolveSessionId,
  sessionShortCode,
} from "@/lib/mastery";

export async function GET(request: NextRequest) {
  try {
    const q =
      request.nextUrl.searchParams.get("sessionId") ||
      request.nextUrl.searchParams.get("code") ||
      "";
    if (!isValidSessionRef(q)) {
      return NextResponse.json(
        { error: "session not found — invalid code format (use the 8-character code or full session id)" },
        { status: 400 },
      );
    }
    const sessionId = await resolveSessionId(q);
    if (!sessionId) {
      return NextResponse.json(
        { error: "session not found — check code or full session id" },
        { status: 404 },
      );
    }

    const session = await loadMastery(sessionId);
    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    const arts = session.artifacts ?? {};
    const priorities = session.roadmap?.priorities ?? [];
    const skills = priorities.map((p) => ({
      componentId: p.componentId,
      order: p.order,
      skill: p.skill,
      priority: p.priority,
      whyNow: p.whyNow,
      masteryLooksLike: p.masteryLooksLike,
      standardCodes: p.standardCodes ?? [],
      artifacts: {
        quiz: Boolean(arts.quizzes?.[p.componentId]),
        cfu: Boolean(arts.cfus?.[p.componentId]),
        studySheet: Boolean(arts.studySheets?.[p.componentId]),
        differentiation: Boolean(arts.differentiations?.[p.componentId]),
        teacherLesson: Boolean(arts.teacherLessons?.[p.componentId]),
        teacherPrep: Boolean(arts.teacherPrep?.[p.componentId]),
      },
    }));

    return NextResponse.json({
      sessionId,
      shortCode: sessionShortCode(sessionId),
      createdAt: session.createdAt,
      grade: session.grade,
      result: {
        score: session.result.score,
        total: session.result.total,
        percent: session.result.percent,
        byComponent: session.result.byComponent,
        weakCount: session.result.weakComponents.length,
        strongCount: session.result.strongComponents.length,
      },
      roadmapSummary: session.roadmap?.summary ?? null,
      nextCheckpoint: session.roadmap?.nextCheckpoint ?? null,
      skills,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
