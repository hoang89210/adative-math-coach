import { NextRequest, NextResponse } from "next/server";
import {
  cacheCfu,
  getCachedCfu,
  loadMastery,
} from "@/lib/mastery";
import { getMisconceptionsForComponent } from "@/lib/misconceptions";
import { withLlmRequestKey } from "@/lib/llm";
import {
  resolvePriorityContext,
  resolveSkillLabel,
} from "@/lib/session-skill";
import { generateCfuCheck } from "@/lib/skills/cfu";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return withLlmRequestKey(request, async () => {
    try {
      const body = (await request.json()) as {
        sessionId?: string;
        componentId?: string;
        refresh?: boolean;
      };
      const sessionId = String(body.sessionId ?? "").trim();
      const componentId = String(body.componentId ?? "").trim();
      if (!sessionId || !componentId) {
        return NextResponse.json(
          { error: "sessionId and componentId are required" },
          { status: 400 },
        );
      }

      const session = await loadMastery(sessionId);
      if (!session) {
        return NextResponse.json(
          { error: "session not found" },
          { status: 404 },
        );
      }

      if (!body.refresh) {
        const cached = await getCachedCfu(sessionId, componentId);
        if (cached) {
          return NextResponse.json({
            sessionId,
            componentId,
            cfu: cached,
            cached: true,
          });
        }
      }

      const skill = resolveSkillLabel(session, componentId);
      const priority = resolvePriorityContext(session, componentId);
      const misconceptionHints = getMisconceptionsForComponent(
        componentId,
        6,
      ).map((m) => m.description);
      const cfu = await generateCfuCheck({
        componentId,
        skill,
        grade: session.grade,
        masteryLooksLike: priority?.masteryLooksLike,
        misconceptionHints,
      });

      await cacheCfu(sessionId, componentId, cfu);
      return NextResponse.json({
        sessionId,
        componentId,
        cfu,
        cached: false,
        misconceptionCount: misconceptionHints.length,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  });
}
