import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { callLlmJson, hasLlmKey } from "@/lib/llm";
import {
  cacheStudySheet,
  getCachedStudySheet,
  loadMastery,
} from "@/lib/mastery";
import {
  resolvePriorityContext,
  resolveSkillLabel,
} from "@/lib/session-skill";
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

function fallbackSheet(skill: string, grade: string): StudySheet {
  return {
    title: `Study sheet: ${skill}`,
    skillSummary: `Grade ${grade} focus — ${skill}`,
    keyIdea: `This skill is about understanding and using: ${skill}. Read slowly and connect each step to why it works.`,
    workedExample: {
      problem: `Think of a simple Grade ${grade} situation that needs: ${skill}.`,
      solution:
        "1) Restate what you know. 2) Choose a method. 3) Check if the answer makes sense.",
    },
    commonMistakes: [
      "Rushing without reading the whole problem",
      "Skipping the check step",
      "Mixing up related ideas that look similar",
    ],
    tryOnYourOwnTips: [
      "Cover the solution and retry the example in your own words",
      "Make one similar problem and solve it",
      "Tell a friend/parent the key idea in one sentence",
    ],
    encouragement: "You can get this with short, steady practice. One clear example at a time.",
  };
}

export async function POST(request: NextRequest) {
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

    const skill = resolveSkillLabel(session, componentId);
    if (!body.refresh) {
      const cached = await getCachedStudySheet(sessionId, componentId);
      if (cached) {
        return NextResponse.json({
          sessionId,
          componentId,
          skill,
          sheet: cached,
          cached: true,
        });
      }
    }

    const priority = resolvePriorityContext(session, componentId);
    let sheet = fallbackSheet(skill, session.grade);

    if (hasLlmKey()) {
      try {
        const llm = await callLlmJson<LlmStudySheet>({
          system: `You write a SHORT student-facing math study sheet for one skill.
Audience: the student (self-study), friendly and clear. US grade-appropriate.
NOT a full lesson plan. NOT a long worksheet pack.
Return ONLY JSON:
{
  "title": "...",
  "skillSummary": "1-2 sentences",
  "keyIdea": "2-4 sentences core idea",
  "workedExample": {"problem":"...","solution":"short step-by-step"},
  "commonMistakes": ["2-3 items"],
  "tryOnYourOwnTips": ["2-3 short tips, not a list of 20 problems"],
  "encouragement": "1 short sentence"
}
Rules:
- No diagrams required
- Keep solution steps short
- Do not invent multi-day units or teacher scripts`,
          user: JSON.stringify({
            grade: session.grade,
            componentId,
            skill,
            whyNow: priority?.whyNow ?? null,
            masteryLooksLike: priority?.masteryLooksLike ?? null,
            studyMoves: priority?.studyMoves ?? null,
          }),
        });

        const parsed: StudySheet = {
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
            .filter(Boolean)
            .slice(0, 4),
          tryOnYourOwnTips: (llm.tryOnYourOwnTips ?? sheet.tryOnYourOwnTips)
            .map(String)
            .filter(Boolean)
            .slice(0, 4),
          encouragement: String(llm.encouragement ?? sheet.encouragement),
        };

        if (parsed.keyIdea && parsed.workedExample.problem) {
          sheet = parsed;
        }
      } catch (err) {
        console.error("Study sheet LLM failed, using fallback", err);
      }
    }

    await cacheStudySheet(sessionId, componentId, sheet);
    return NextResponse.json({
      sessionId,
      componentId,
      skill,
      sheet,
      cached: false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
