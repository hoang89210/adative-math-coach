import { withLlmRequestKey } from "@/lib/llm";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import {
  getCachedCfu,
  loadMastery,
  resolveSessionId,
} from "@/lib/mastery";
import { generateCfuCheck } from "@/lib/skills/cfu";
import { cacheCfu } from "@/lib/mastery";
import {
  resolvePriorityContext,
  resolveSkillLabel,
} from "@/lib/session-skill";

export async function GET(request: NextRequest) {
  return withLlmRequestKey(request, async () => {
  try {
    const sessionId = await resolveSessionId(
      request.nextUrl.searchParams.get("sessionId") || "",
    );
    const componentId = (
      request.nextUrl.searchParams.get("componentId") || ""
    ).trim();
    const generate =
      request.nextUrl.searchParams.get("generate") === "1" ||
      request.nextUrl.searchParams.get("generate") === "true";

    if (!sessionId || !componentId) {
      return NextResponse.json(
        { error: "sessionId and componentId required" },
        { status: 400 },
      );
    }

    const session = await loadMastery(sessionId);
    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    let cfu = await getCachedCfu(sessionId, componentId);
    if (!cfu && generate) {
      const skill = resolveSkillLabel(session, componentId);
      const priority = resolvePriorityContext(session, componentId);
      cfu = await generateCfuCheck({
        componentId,
        skill,
        grade: session.grade,
        masteryLooksLike: priority?.masteryLooksLike,
      });
      await cacheCfu(sessionId, componentId, cfu);
    }

    if (!cfu) {
      return NextResponse.json(
        { error: "CFU not found — pass generate=1 or have student generate first" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      sessionId,
      componentId,
      guide: {
        focus: cfu.focus,
        rigor: cfu.rigor,
        items: cfu.items.map((item) => ({
          id: item.id,
          stem: item.stem,
          correct_answer: item.correct_answer,
          options: item.options,
          responseRoutes: item.responseRoutes,
        })),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
});
}
