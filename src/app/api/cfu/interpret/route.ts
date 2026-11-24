import { NextRequest, NextResponse } from "next/server";
import { getCachedCfu, loadMastery } from "@/lib/mastery";
import { matchCfuRoute } from "@/lib/skills/cfu";
import type { CfuInterpretation } from "@/lib/types/skills";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      componentId?: string;
      answers?: Array<{ itemId: string; answer: string }>;
    };
    const sessionId = String(body.sessionId ?? "").trim();
    const componentId = String(body.componentId ?? "").trim();
    const answers = body.answers ?? [];

    if (!sessionId || !componentId) {
      return NextResponse.json(
        { error: "sessionId and componentId are required" },
        { status: 400 },
      );
    }

    if (!(await loadMastery(sessionId))) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    const cfu = await getCachedCfu(sessionId, componentId);
    if (!cfu) {
      return NextResponse.json(
        { error: "CFU not found — generate first" },
        { status: 404 },
      );
    }

    const answerMap = new Map(answers.map((a) => [a.itemId, a.answer]));
    const interpretations: CfuInterpretation[] = cfu.items.map((item) => {
      const studentAnswer = answerMap.get(item.id) ?? "";
      const { isCorrect, route } = matchCfuRoute(item, studentAnswer);
      const feedback = route
        ? `${route.reveals} Next: ${route.nextStep}`
        : isCorrect
          ? "You landed on a solid answer. Explain your reasoning once more to lock it in."
          : "Your answer did not match a mapped route. Re-read the stem and try naming the key idea first.";

      return {
        itemId: item.id,
        studentAnswer,
        matchedRoute: route,
        isCorrect,
        feedback,
      };
    });

    return NextResponse.json({
      sessionId,
      componentId,
      focus: cfu.focus,
      interpretations,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
