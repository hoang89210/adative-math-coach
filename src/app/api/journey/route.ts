import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-errors";
import { loadMastery, resolveSessionId } from "@/lib/mastery";
import {
  getJourneyTimeline,
  normalizeGradeKey,
} from "@/lib/standards/catalog";

const ORDER = [
  "K",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
];

export async function GET(request: NextRequest) {
  try {
    const gradeParam = request.nextUrl.searchParams.get("grade") ?? "";
    const sessionParam =
      request.nextUrl.searchParams.get("sessionId") ||
      request.nextUrl.searchParams.get("code") ||
      "";

    let currentGrade = normalizeGradeKey(gradeParam);
    let gaps: Array<{ skill: string; priority: string }> = [];
    let strengths: string[] = [];
    let percent: number | null = null;

    if (sessionParam) {
      const sid = await resolveSessionId(sessionParam);
      if (sid) {
        const session = await loadMastery(sid);
        if (session) {
          currentGrade = normalizeGradeKey(session.grade) ?? currentGrade;
          percent = session.result.percent;
          gaps = (session.roadmap?.priorities ?? [])
            .filter((p) => p.priority === "high" || p.priority === "medium")
            .slice(0, 6)
            .map((p) => ({ skill: p.skill, priority: p.priority }));
          strengths = (session.roadmap?.strengthsToKeep ?? []).slice(0, 4);
          if (gaps.length === 0) {
            gaps = session.result.weakComponents.slice(0, 5).map((c) => ({
              skill: c.description,
              priority: "high",
            }));
          }
        }
      }
    }

    if (!currentGrade) {
      return NextResponse.json(
        { error: "grade or valid sessionId is required" },
        { status: 400 },
      );
    }

    const timeline = getJourneyTimeline();
    const idx = ORDER.indexOf(currentGrade);

    const nodes = timeline.map((node) => {
      const nodeIdx = ORDER.indexOf(node.grade);
      let phase: "past" | "now" | "future" = "future";
      if (nodeIdx < idx) phase = "past";
      if (nodeIdx === idx) phase = "now";
      return {
        ...node,
        phase,
        isCurrent: node.grade === currentGrade,
      };
    });

    return NextResponse.json({
      currentGrade,
      percent,
      gaps,
      strengths,
      motivation:
        gaps.length > 0
          ? "Close today’s gaps to unlock stronger moves in the grades ahead — your path runs from Kindergarten foundations all the way through grade 12."
          : "You’re on track at this checkpoint. Keep skills warm and explore what’s coming next through grade 12.",
      nodes,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
