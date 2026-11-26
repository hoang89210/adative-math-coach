import { withLlmRequestKey } from "@/lib/llm";
import { errorResponse, readJsonBody } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import {
  cacheTeacherPrep,
  getCachedTeacherLesson,
  getCachedTeacherPrep,
  loadMastery,
  resolveSessionId,
} from "@/lib/mastery";
import {
  continuePrep,
  enrichPrepOpener,
  finalizePrep,
  startPrepState,
} from "@/lib/skills/lesson-prep";

export async function POST(request: NextRequest) {
  return withLlmRequestKey(request, async () => {
  try {
    const body = (await readJsonBody(request)) as {
      sessionId?: string;
      componentId?: string;
      action?: "start" | "turn" | "finalize";
      message?: string;
    };

    const sessionId = await resolveSessionId(String(body.sessionId ?? ""));
    const componentId = String(body.componentId ?? "").trim();
    const action = body.action ?? "start";
    if (!sessionId || !componentId) {
      return NextResponse.json(
        { error: "sessionId and componentId are required" },
        { status: 400 },
      );
    }
    if (!(await loadMastery(sessionId))) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    const lesson = await getCachedTeacherLesson(sessionId, componentId);
    if (!lesson) {
      return NextResponse.json(
        { error: "Build a lesson for this skill before prep" },
        { status: 400 },
      );
    }

    if (action === "start") {
      let prep = startPrepState(lesson);
      prep = await enrichPrepOpener(lesson, prep);
      await cacheTeacherPrep(sessionId, componentId, prep);
      return NextResponse.json({ sessionId, componentId, prep });
    }

    const existing = await getCachedTeacherPrep(sessionId, componentId);
    if (!existing) {
      return NextResponse.json(
        { error: "Prep not started" },
        { status: 400 },
      );
    }

    if (action === "turn") {
      const message = String(body.message ?? "").trim();
      if (!message) {
        return NextResponse.json(
          { error: "message is required" },
          { status: 400 },
        );
      }
      if (/^finalize$/i.test(message.trim())) {
        const prep = await finalizePrep({ lesson, state: existing });
        await cacheTeacherPrep(sessionId, componentId, prep);
        return NextResponse.json({ sessionId, componentId, prep });
      }
      const prep = await continuePrep({
        lesson,
        state: existing,
        teacherMessage: message,
      });
      await cacheTeacherPrep(sessionId, componentId, prep);
      return NextResponse.json({ sessionId, componentId, prep });
    }

    if (action === "finalize") {
      const prep = await finalizePrep({ lesson, state: existing });
      await cacheTeacherPrep(sessionId, componentId, prep);
      return NextResponse.json({ sessionId, componentId, prep });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
});
}
