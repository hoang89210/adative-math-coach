import { withLlmRequestKey } from "@/lib/llm";
import { errorResponse, readJsonBody } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import {
  cacheTeacherLesson,
  getCachedStudySheet,
  getCachedTeacherLesson,
  loadMastery,
  resolveSessionId,
} from "@/lib/mastery";
import {
  resolvePriorityContext,
  resolveSkillLabel,
} from "@/lib/session-skill";
import { generateTeacherLesson } from "@/lib/skills/lesson-plan";

export async function POST(request: NextRequest) {
  return withLlmRequestKey(request, async () => {
  try {
    const body = (await readJsonBody(request)) as {
      sessionId?: string;
      componentId?: string;
      refresh?: boolean;
      statementCode?: string;
    };
    const sessionId = await resolveSessionId(String(body.sessionId ?? ""));
    const componentId = String(body.componentId ?? "").trim();
    if (!sessionId || !componentId) {
      return NextResponse.json(
        { error: "sessionId and componentId are required" },
        { status: 400 },
      );
    }

    const session = await loadMastery(sessionId);
    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    if (!body.refresh) {
      const cached = await getCachedTeacherLesson(sessionId, componentId);
      if (cached) {
        return NextResponse.json({
          sessionId,
          componentId,
          lesson: cached,
          cached: true,
        });
      }
    }

    const skill = resolveSkillLabel(session, componentId);
    const priority = resolvePriorityContext(session, componentId);
    const sheet = await getCachedStudySheet(sessionId, componentId);
    const picked = body.statementCode?.trim();
    const standardCodes = picked
      ? [picked, ...(priority?.standardCodes ?? []).filter((c) => c !== picked)]
      : priority?.standardCodes;

    const lesson = await generateTeacherLesson({
      componentId,
      skill,
      grade: session.grade,
      whyNow: priority?.whyNow,
      masteryLooksLike: priority?.masteryLooksLike,
      standardCodes,
      sheet,
    });

    await cacheTeacherLesson(sessionId, componentId, lesson);
    return NextResponse.json({
      sessionId,
      componentId,
      lesson,
      cached: false,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
}
