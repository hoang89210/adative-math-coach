import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-errors";
import {
  getCachedDifferentiation,
  loadMastery,
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
    if (!(await loadMastery(sessionId))) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    const pack = await getCachedDifferentiation(sessionId, componentId);
    if (!pack) {
      return NextResponse.json(
        {
          error:
            "Differentiation not found — generate from student results (Leveled practice) first",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      sessionId,
      componentId,
      plan: {
        sourceSheetTitle: pack.sourceSheetTitle,
        teacherPlanLite: pack.teacherPlanLite,
        tiers: pack.tiers.map((t) => ({
          group: t.group,
          level: t.level,
          title: t.title,
          intro: t.intro,
          taskCount: t.tasks.length,
          tasks: t.tasks,
          exitCheck: t.exitCheck,
        })),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
