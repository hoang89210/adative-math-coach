import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { getComponentsByIds } from "@/lib/data/learning-components";
import { listLabArtifacts } from "@/lib/lab/artifacts";
import { evaluateMathAlignmentLab } from "@/lib/lab/math-alignment";
import { loadMastery, resolveSessionId } from "@/lib/mastery";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      question?: string;
      statement_code?: string;
      jurisdiction?: string;
      sessionId?: string;
      artifactId?: string;
      componentId?: string;
    };

    let question = String(body.question ?? "").trim();
    let statement_code = String(body.statement_code ?? "").trim();
    const jurisdiction = String(body.jurisdiction ?? "Multi-State").trim();
    let hints: Array<{ id: string; description: string }> = [];

    if (body.sessionId && body.artifactId) {
      const listed = await listLabArtifacts(body.sessionId);
      const art = listed.artifacts.find((a) => a.id === body.artifactId);
      if (!art) {
        return NextResponse.json(
          { error: "artifact not found on session" },
          { status: 404 },
        );
      }
      if (!question) question = art.text;
      if (!statement_code && art.statementCodes?.length) {
        statement_code = art.statementCodes[0]!;
      }
      if (art.componentId) {
        const session = await loadMastery(listed.sessionId);
        if (session) {
          const comps = await getComponentsByIds(session.grade, [
            art.componentId,
          ]);
          const c = comps[0];
          if (c) {
            hints = [
              { id: c.id, description: c.description },
              ...c.relatedStandards.slice(0, 3).map((s) => ({
                id: s.id,
                description: s.code
                  ? `${s.code}: ${s.description}`
                  : s.description,
              })),
            ];
            if (!statement_code) {
              const code = c.relatedStandards.find((s) => s.code)?.code;
              if (code) statement_code = code;
            }
          }
        }
      }
    } else if (body.sessionId && body.componentId) {
      const sid = await resolveSessionId(body.sessionId);
      if (sid) {
        const session = await loadMastery(sid);
        if (session) {
          const comps = await getComponentsByIds(session.grade, [
            body.componentId,
          ]);
          const c = comps[0];
          if (c) {
            hints = [{ id: c.id, description: c.description }];
            if (!statement_code) {
              const code = c.relatedStandards.find((s) => s.code)?.code;
              if (code) statement_code = code;
            }
            if (!question) question = c.description;
          }
        }
      }
    }

    if (!question || !statement_code) {
      return NextResponse.json(
        {
          error:
            "question and statement_code are required (or session+artifact with codes)",
        },
        { status: 400 },
      );
    }

    const result = await evaluateMathAlignmentLab({
      question,
      statement_code,
      jurisdiction,
      learningComponentHints: hints,
    });

    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
