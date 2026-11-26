import { NextRequest, NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/api-errors";

export const maxDuration = 60;
import { getComponentsByIds } from "@/lib/data/learning-components";
import {
  orderComponentsByProgression,
  priorityTier,
} from "@/lib/data/progression";
import { callLlmJson, hasLlmKey, withLlmRequestKey } from "@/lib/llm";
import { logError } from "@/lib/log-safe";

import { loadMastery, updateMasteryRoadmap } from "@/lib/mastery";
import { analyzeRootGaps } from "@/lib/data/prereq-graph";
import { type BetaParams, posteriorsFromTallies } from "@/lib/lc-mastery";
import { isValidLearnerId, loadLcMastery } from "@/lib/lc-mastery-store";
import type { CoachPriority, FoundationStep, Roadmap } from "@/lib/types/quiz";

/**
 * Root-gap foundations: prepend "Ôn nền tảng" (review) or "Kiểm tra nhanh"
 * (diagnose, when earlier skills have no data) steps to the plan. Uses the
 * learner's cumulative LC posteriors when the session has a learner, else
 * this session's evidence. Never throws (plan still works without it).
 */
async function withFoundations(
  roadmap: Roadmap,
  session: { learnerId?: string; jurisdiction?: string; grade?: string; result: { byComponent: Array<{ componentId: string; correct: number; total: number }> } },
): Promise<Roadmap> {
  try {
    let posteriors = new Map<string, BetaParams>();
    if (session.learnerId && isValidLearnerId(session.learnerId)) {
      posteriors = (await loadLcMastery(session.learnerId)).posteriors;
    }
    if (posteriors.size === 0) {
      posteriors = posteriorsFromTallies(session.result.byComponent);
    }
    const reports = analyzeRootGaps({
      posteriors,
      jurisdiction: session.jurisdiction,
      grade: session.grade,
      maxReports: 2,
    });
    if (!reports.length) return { ...roadmap, foundations: [] };
    const foundations: FoundationStep[] = reports.map((r) => ({
      kind: r.kind,
      suggestion: r.suggestion,
      rootStandardId: r.root?.standardId ?? null,
      rootLabel: r.root?.label ?? null,
      checkLabels: r.checkPrereqs.map((c) => c.label),
      targetStandardId: r.target.standardId,
      targetLabel: r.target.label,
      rootLcId: r.root?.lcId ?? r.diagnostics[0]?.lcId ?? null,
      depth: r.depth,
      dataSource: r.dataSource,
      rootState: r.root?.state ?? null,
      diagnostics: r.diagnostics.map((d) => ({
        lcId: d.lcId,
        skill: d.skill,
        prompt: d.prompt,
      })),
    }));
    const existing = roadmap.priorities ?? [];
    const have = new Set(existing.map((p) => p.componentId));
    const source = (f: FoundationStep) =>
      f.dataSource === "heuristic"
        ? " (prerequisite guessed by heuristic: same domain, lower grade)"
        : " (Learning Commons progression)";
    const extra: CoachPriority[] = foundations
      .filter((f) => f.rootLcId && !have.has(f.rootLcId))
      .map((f) =>
        f.kind === "review"
          ? {
              order: 0,
              componentId: f.rootLcId!,
              skill: f.suggestion,
              whyNow: `Nearest earlier skill with a gap, ${f.depth} step(s) below ${f.targetLabel}${source(f)}. Fixing the foundation first makes the later skill easier.`,
              masteryLooksLike: `You can solve ${f.rootLabel} problems correctly without hints (≥70% over at least 3 answers), then return to ${f.targetLabel}.`,
              studyMoves: [
                "Review one worked example of the foundation skill.",
                "Do 2–3 short problems on it before going back to the harder skill.",
              ],
              dependsOn: [],
              priority: "high" as const,
              standardCodes: f.rootLabel ? [f.rootLabel] : [],
            }
          : {
              order: 0,
              componentId: f.rootLcId!,
              skill: f.suggestion,
              whyNow: `No answers yet on the skills right before ${f.targetLabel}${source(f)}. A quick check tells us whether to review them first.`,
              masteryLooksLike: "You answer the quick checks correctly without hints.",
              studyMoves: f.diagnostics.map((d) => d.prompt).slice(0, 3),
              dependsOn: [],
              priority: "high" as const,
              standardCodes: f.checkLabels ?? [],
            },
      );
    const priorities = [...extra, ...existing].map((p, i) => ({
      ...p,
      order: i + 1,
    }));
    return { ...roadmap, foundations, priorities };
  } catch (err) {
    logError("root-gap foundations failed", err);
    return roadmap;
  }
}

type LlmCoachPlan = {
  summary?: string;
  priorities?: Array<{
    componentId?: string;
    skill?: string;
    whyNow?: string;
    masteryLooksLike?: string;
    studyMoves?: string[];
    dependsOn?: string[];
    priority?: string;
  }>;
  strengthsToKeep?: string[];
  nextCheckpoint?: string;
};

function buildLocalCoachPlan(input: {
  grade: string;
  percent: number;
  orderedWeak: Array<{
    componentId: string;
    description: string;
    correct: number;
    total: number;
    standardCodes: string[];
    dependsOnLabels: string[];
  }>;
  strong: Array<{ description: string }>;
}): Roadmap {
  const { orderedWeak, strong, percent, grade } = input;

  if (orderedWeak.length === 0) {
    return {
      summary:
        percent === 100
          ? `Great work on the Grade ${grade} diagnostic — every checked skill looked solid. Keep momentum with light mixed review and stretch challenges on your strengths.`
          : `Strong showing on the Grade ${grade} diagnostic. Focus on maintaining accuracy and connecting skills you already own.`,
      priorities: strong.slice(0, 4).map((s, i) => ({
        order: i + 1,
        componentId: `strong-${i}`,
        skill: s.description,
        whyNow:
          "You already show strength here — deepen it so it stays automatic under mixed problems.",
        masteryLooksLike: `You can explain and apply “${s.description}” in a new context without hints.`,
        studyMoves: [
          "Do a short mixed review that includes this skill next to a related skill.",
          "Explain the method out loud in 2–3 sentences.",
          "Try one harder multi-step version of a familiar problem type.",
        ],
        dependsOn: [],
        priority: priorityTier(i, Math.max(strong.length, 1)),
        standardCodes: [],
      })),
      strengthsToKeep: strong.slice(0, 5).map((s) => s.description),
      nextCheckpoint:
        "Retake a short mixed check in 3–5 days to confirm skills stay strong.",
    };
  }

  const priorities: CoachPriority[] = orderedWeak
    .slice(0, 6)
    .map((w, i) => ({
      order: i + 1,
      componentId: w.componentId,
      skill: w.description,
      whyNow:
        i === 0
          ? `Start here: it is an early gap on your Grade ${grade} path${w.dependsOnLabels.length ? " and supports later skills" : ""}.`
          : `Next focus after earlier foundations: rebuild “${w.description}”.`,
      masteryLooksLike: `You correctly solve problems about “${w.description}” and can say why the method works.`,
      studyMoves: [
        "Revisit the idea with a worked example; name each step.",
        "Try 2 guided problems, then 1 on your own without looking back.",
        "Write one sentence: what mistake to avoid on this skill.",
      ],
      dependsOn: w.dependsOnLabels,
      priority: priorityTier(i, Math.min(orderedWeak.length, 6)),
      standardCodes: w.standardCodes,
    }));

  return {
    summary: `On this Grade ${grade} diagnostic you scored ${percent}%. ${orderedWeak.length} skill area(s) need attention. Follow the ordered plan below — earlier steps unlock later ones when the knowledge graph shows a dependency.`,
    priorities,
    strengthsToKeep: strong.slice(0, 5).map((s) => s.description),
    nextCheckpoint:
      "After working the high-priority items, retake a short check on those skills before moving on.",
  };
}

export async function POST(request: NextRequest) {
  return withLlmRequestKey(request, async () => {
  try {
    const body = (await readJsonBody(request)) as {
      sessionId?: string;
      refresh?: boolean;
    };
    const sessionId = String(body.sessionId ?? "").trim();
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    const session = await loadMastery(sessionId);
    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    // Serve cached coach plan unless refresh requested
    if (
      session.roadmap?.priorities?.length &&
      !body.refresh &&
      session.roadmap.summary
    ) {
      return NextResponse.json({ sessionId, roadmap: session.roadmap });
    }

    const { result } = session;
    const weakIds = result.weakComponents.map((c) => c.componentId);
    const meta = await getComponentsByIds(result.grade, weakIds);
    const metaById = new Map(meta.map((m) => [m.id, m]));

    const weakForOrder = result.weakComponents.map((w) => {
      const m = metaById.get(w.componentId);
      return {
        componentId: w.componentId,
        description: w.description,
        correct: w.correct,
        total: w.total,
        standardIds: (m?.relatedStandards ?? []).map((s) => s.id),
        standardCodes: (m?.relatedStandards ?? [])
          .map((s) => s.code)
          .filter(Boolean) as string[],
      };
    });

    const ordered = orderComponentsByProgression(weakForOrder);

    // Map dependsOn standard ids -> human labels when possible
    const stdLabel = new Map<string, string>();
    for (const m of meta) {
      for (const s of m.relatedStandards) {
        stdLabel.set(s.id, s.code || s.description.slice(0, 80));
      }
    }

    const orderedWeak = ordered.map((o) => ({
      componentId: o.componentId,
      description: o.description,
      correct: o.correct,
      total: o.total,
      standardCodes:
        weakForOrder.find((w) => w.componentId === o.componentId)
          ?.standardCodes ?? [],
      dependsOnLabels: o.dependsOnStandardIds
        .map((id) => stdLabel.get(id) || id)
        .slice(0, 3),
    }));

    let roadmap = buildLocalCoachPlan({
      grade: result.grade,
      percent: result.percent,
      orderedWeak,
      strong: result.strongComponents,
    });

    if (hasLlmKey()) {
      try {
        const llm = await callLlmJson<LlmCoachPlan>({
          system: `You are a math learning coach for US K-12 students and families.
Write a DIRECTIONAL learning plan — NOT a lesson plan, NOT worksheets, NOT practice item text.
Return ONLY JSON:
{
  "summary": "2-4 sentences diagnosis",
  "priorities": [{
    "componentId": "...",
    "skill": "short skill name",
    "whyNow": "why this order",
    "masteryLooksLike": "observable mastery",
    "studyMoves": ["2-4 short study moves, no full lesson"],
    "dependsOn": ["optional prior ideas"],
    "priority": "high|medium|later"
  }],
  "strengthsToKeep": ["..."],
  "nextCheckpoint": "when/how to recheck"
}
Rules:
- Keep the PROVIDED order of componentIds (already sequenced by prerequisites when known)
- 3 to 6 priorities max
- Student-friendly language appropriate to the grade (elementary through high school)
- No generating practice problems or lesson scripts
- studyMoves = habits/strategies (worked example, explain aloud, spaced review), not item lists`,
          user: JSON.stringify({
            grade: result.grade,
            percent: result.percent,
            orderedGaps: orderedWeak.map((w, i) => ({
              order: i + 1,
              componentId: w.componentId,
              skill: w.description,
              correct: w.correct,
              total: w.total,
              standardCodes: w.standardCodes,
              dependsOn: w.dependsOnLabels,
              suggestedPriority: priorityTier(
                i,
                Math.min(orderedWeak.length, 6),
              ),
            })),
            strengths: result.strongComponents.map((s) => s.description),
          }),
        });

        const byId = new Map(
          orderedWeak.map((w) => [w.componentId, w] as const),
        );
        const priorities: CoachPriority[] = (llm.priorities ?? [])
          .map((p, i) => {
            const id = String(p.componentId ?? "");
            const base = byId.get(id);
            if (!base && orderedWeak.length > 0) {
              // allow extension-only ids when no weak skills
            }
            const tier =
              p.priority === "medium" || p.priority === "later"
                ? p.priority
                : p.priority === "high"
                  ? "high"
                  : priorityTier(i, 6);
            return {
              order: i + 1,
              componentId: id || base?.componentId || `item-${i}`,
              skill: String(p.skill ?? base?.description ?? "Skill"),
              whyNow: String(p.whyNow ?? ""),
              masteryLooksLike: String(p.masteryLooksLike ?? ""),
              studyMoves: (p.studyMoves ?? [])
                .map(String)
                .filter(Boolean)
                .slice(0, 4),
              dependsOn: (p.dependsOn ?? base?.dependsOnLabels ?? []).map(
                String,
              ),
              priority: tier,
              standardCodes: base?.standardCodes ?? [],
            } satisfies CoachPriority;
          })
          .filter((p) => p.skill && p.whyNow && p.studyMoves.length > 0);

        if (priorities.length >= 1) {
          roadmap = {
            summary: String(llm.summary ?? roadmap.summary),
            priorities: priorities.slice(0, 6),
            strengthsToKeep: (llm.strengthsToKeep ?? roadmap.strengthsToKeep)
              ?.map(String)
              .slice(0, 6),
            nextCheckpoint: String(
              llm.nextCheckpoint ?? roadmap.nextCheckpoint ?? "",
            ),
          };
        }
      } catch (err) {
        logError("LLM coach plan failed, using local", err);
      }
    }

    roadmap = await withFoundations(roadmap, session);
    await updateMasteryRoadmap(sessionId, roadmap);
    return NextResponse.json({ sessionId, roadmap });
  } catch (err) {
    return errorResponse(err);
  }
});
}
