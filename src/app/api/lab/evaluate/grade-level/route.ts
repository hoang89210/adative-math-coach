import { withLlmRequestKey } from "@/lib/llm";
import { errorResponse, readJsonBody } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { listLabArtifacts } from "@/lib/lab/artifacts";
import { evaluateGradeLevelLab } from "@/lib/lab/grade-level";

export async function POST(request: NextRequest) {
  return withLlmRequestKey(request, async () => {
  try {
    const body = (await readJsonBody(request)) as {
      text?: string;
      target_grade?: string;
      sessionId?: string;
      artifactId?: string;
    };

    let text = String(body.text ?? "").trim();
    let target_grade = body.target_grade
      ? String(body.target_grade).trim()
      : undefined;

    if (body.sessionId && body.artifactId) {
      const listed = await listLabArtifacts(body.sessionId);
      const art = listed.artifacts.find((a) => a.id === body.artifactId);
      if (!art) {
        return NextResponse.json(
          { error: "artifact not found on session" },
          { status: 404 },
        );
      }
      if (!text) text = art.text;
      if (!target_grade) target_grade = listed.grade;
    }

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const result = await evaluateGradeLevelLab({ text, target_grade });
    return NextResponse.json({ result });
  } catch (err) {
    return errorResponse(err);
  }
});
}
