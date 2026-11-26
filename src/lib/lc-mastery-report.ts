import { getStandardIndex } from "@/lib/data/learning-components";
import { loadProgression } from "@/lib/data/progression";
import { type RootGapReport, analyzeRootGaps } from "@/lib/data/prereq-graph";
import {
  type BetaParams,
  type HeatmapRow,
  GAP_MAX_MEAN,
  GAP_MIN_N,
  INSUFFICIENT_BELOW_N,
  MASTERED_MIN_MEAN,
  MASTERED_MIN_N,
  buildHeatmap,
} from "@/lib/lc-mastery";

export type LcMasteryReport = {
  heatmap: HeatmapRow[];
  rootGaps: RootGapReport[];
  lcCount: number;
  thresholds: {
    masteredMinMean: number;
    masteredMinN: number;
    gapMaxMean: number;
    gapMinN: number;
    insufficientBelowN: number;
  };
  prereqData: {
    source: string;
    edgeCount: number;
    alignmentCount: number;
    heuristicFallback: string;
  };
};

/** Heatmap + root gaps for a set of LC posteriors (server-only; reads data/). */
export function buildLcMasteryReport(
  posteriors: Map<string, BetaParams>,
  jurisdiction?: string,
): LcMasteryReport {
  const idx = getStandardIndex();
  const lcMeta = [...posteriors.keys()].map((id) => {
    const c = idx.components.get(id);
    return {
      id,
      description: c?.description ?? id,
      standards: (c?.relatedStandards ?? []).map((s) => ({
        id: s.id,
        code: s.code,
        description: s.description,
        jurisdiction: s.jurisdiction,
      })),
    };
  });
  const prog = loadProgression();
  return {
    heatmap: buildHeatmap({ posteriors, lcMeta, jurisdiction }),
    rootGaps: analyzeRootGaps({ posteriors, jurisdiction, maxReports: 3 }),
    lcCount: posteriors.size,
    thresholds: {
      masteredMinMean: MASTERED_MIN_MEAN,
      masteredMinN: MASTERED_MIN_N,
      gapMaxMean: GAP_MAX_MEAN,
      gapMinN: GAP_MIN_N,
      insufficientBelowN: INSUFFICIENT_BELOW_N,
    },
    prereqData: {
      source:
        prog?.source ??
        "Learning Commons Knowledge Graph buildsTowards (progression-index.json)",
      edgeCount: prog?.edgeCount ?? 0,
      alignmentCount: prog?.alignmentCount ?? 0,
      heuristicFallback:
        "HEURISTIC when no KG path exists: same jurisdiction + domain, one grade lower",
    },
  };
}
