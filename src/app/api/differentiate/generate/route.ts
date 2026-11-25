import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { callLlmJson, hasLlmKey, withLlmRequestKey } from "@/lib/llm";
import { logError } from "@/lib/log-safe";

import {
  cacheDifferentiation,
  cacheStudySheet,
  getCachedDifferentiation,
  getCachedStudySheet,
  loadMastery,
} from "@/lib/mastery";
import {
  resolvePriorityContext,
  resolveSkillLabel,
} from "@/lib/session-skill";
import { generateDifferentiation } from "@/lib/skills/differentiate";
import type { StudySheet } from "@/lib/types/quiz";

type LlmStudySheet = {
  title?: string;
  skillSummary?: string;
  keyIdea?: string;
  workedExample?: { problem?: string; solution?: string };
  commonMistakes?: string[];
  tryOnYourOwnTips?: string[];
  encouragement?: string;
};

async function ensureStudySheet(params: {
  sessionId: string;
  componentId: string;
  skill: string;
  grade: string;
  whyNow?: string | null;
  masteryLooksLike?: string | null;
  studyMoves?: string[] | null;
}): Promise<StudySheet> {
  const cached = await getCachedStudySheet(params.sessionId, params.componentId);
  if (cached) return cached;

  let sheet: StudySheet = {
    title: `Study sheet: ${params.skill}`,
    skillSummary: `Grade ${params.grade} — ${params.skill}`,
    keyIdea: `Focus on understanding: ${params.skill}.`,
    workedExample: {
      problem: `A grade ${params.grade} problem about ${params.skill}.`,
      solution: "Show each step and check the result.",
    },
    commonMistakes: ["Skipping place value", "Rushing the check"],
    tryOnYourOwnTips: ["Retry the example covered", "Explain the key idea aloud"],
    encouragement: "One clear example at a time.",
  };

  if (hasLlmKey()) {
    try {
      const llm = await callLlmJson<LlmStudySheet>({
        system: `Write a SHORT student math study sheet JSON for one skill.
Fields: title, skillSummary, keyIdea, workedExample{problem,solution}, commonMistakes[], tryOnYourOwnTips[], encouragement.
No full lesson plan.`,
        user: JSON.stringify({
          grade: params.grade,
          skill: params.skill,
          whyNow: params.whyNow,
          masteryLooksLike: params.masteryLooksLike,
          studyMoves: params.studyMoves,
        }),
      });
      sheet = {
        title: String(llm.title ?? sheet.title),
        skillSummary: String(llm.skillSummary ?? sheet.skillSummary),
        keyIdea: String(llm.keyIdea ?? sheet.keyIdea),
        workedExample: {
          problem: String(
            llm.workedExample?.problem ?? sheet.workedExample.problem,
          ),
          solution: String(
            llm.workedExample?.solution ?? sheet.workedExample.solution,
          ),
        },
        commonMistakes: (llm.commonMistakes ?? sheet.commonMistakes)
          .map(String)
          .slice(0, 4),
        tryOnYourOwnTips: (llm.tryOnYourOwnTips ?? sheet.tryOnYourOwnTips)
          .map(String)
          .slice(0, 4),
        encouragement: String(llm.encouragement ?? sheet.encouragement),
      };
    } catch (err) {
      logError("Auto study sheet for diff failed", err);
    }
  }

  await cacheStudySheet(params.sessionId, params.componentId, sheet);
  return sheet;
}

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
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    if (!body.refresh) {
      const cached = await getCachedDifferentiation(sessionId, componentId);
      if (cached) {
        return NextResponse.json({
          sessionId,
          componentId,
          pack: cached,
          cached: true,
        });
      }
    }

    const skill = resolveSkillLabel(session, componentId);
    const priority = resolvePriorityContext(session, componentId);
    const sheet = await ensureStudySheet({
      sessionId,
      componentId,
      skill,
      grade: session.grade,
      whyNow: priority?.whyNow,
      masteryLooksLike: priority?.masteryLooksLike,
      studyMoves: priority?.studyMoves,
    });

    const pack = await generateDifferentiation({
      componentId,
      skill,
      grade: session.grade,
      sheet,
    });

    await cacheDifferentiation(sessionId, componentId, pack);
    return NextResponse.json({
      sessionId,
      componentId,
      pack,
      sourceSheet: sheet,
      cached: false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
});
}
