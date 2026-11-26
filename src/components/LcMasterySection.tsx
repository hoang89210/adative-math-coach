"use client";

import { useEffect, useState } from "react";
import type { RootGapReport } from "@/lib/data/prereq-graph";
import type { HeatmapRow, MasteryState, MasterySummary } from "@/lib/lc-mastery";

/**
 * LC mastery heatmap (standard -> LC) + root-gap suggestions.
 * Data comes from POST /api/mastery (our own Beta statistics only).
 *
 * No-DB fallback on the client: when `storageKey` is set, the last report
 * that had data is kept in localStorage; if the server later answers from
 * an empty in-memory store (cold start, no Postgres), the snapshot is shown
 * and clearly labelled. No API keys are ever stored here.
 */

export type MasteryApiResponse = {
  mode: "learner" | "session";
  store: "db" | "memory" | "session";
  persisted: boolean;
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

type Props = {
  request: { learnerId?: string; learnerToken?: string; sessionId?: string; jurisdiction?: string };
  storageKey?: string;
  showHeatmap?: boolean;
  showRootGaps?: boolean;
  title?: string;
  /** shown when the API aggregated every session of the learner */
  aggregationNote?: string;
};

const STATE_LABEL: Record<MasteryState, string> = {
  mastered: "Mastered",
  gap: "Gap",
  learning: "Learning",
  insufficient: "Not enough data",
};

const STATE_CHIP: Record<MasteryState, string> = {
  mastered: "bg-emerald-50 text-emerald-800 border-emerald-200",
  gap: "bg-red-50 text-red-800 border-red-200",
  learning: "bg-amber-50 text-amber-900 border-amber-200",
  insufficient: "bg-zinc-50 text-zinc-600 border-zinc-200",
};

function fmt(x: number) {
  return Number.isInteger(x) ? String(x) : x.toFixed(2);
}

/** Red (0%) -> amber (50%) -> green (100%). */
export function masteryColor(mean: number) {
  const hue = Math.round(Math.max(0, Math.min(1, mean)) * 120);
  return `hsl(${hue} 70% 45%)`;
}

export function cellTooltip(label: string, s: MasterySummary) {
  return [
    label,
    `Correct: ${fmt(s.correct)} · Wrong: ${fmt(s.wrong)}`,
    `Mastery ${Math.round(s.mean * 100)}% (80% sure ≥ ${Math.round(s.lower80 * 100)}%)`,
    `Beta(${fmt(s.alpha)}, ${fmt(s.beta)}) · n=${fmt(s.n)}`,
    STATE_LABEL[s.state],
  ].join("\n");
}

function readSnapshot(key?: string): MasteryApiResponse | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as MasteryApiResponse) : null;
  } catch {
    return null;
  }
}

export function LcMasterySection({
  request,
  storageKey,
  showHeatmap = true,
  showRootGaps = true,
  title = "Skill mastery map",
  aggregationNote,
}: Props) {
  const [data, setData] = useState<MasteryApiResponse | null>(null);
  const [fromSnapshot, setFromSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reqKey = JSON.stringify(request);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/mastery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: reqKey,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Could not load mastery");
        const r = json as MasteryApiResponse;
        if (cancelled) return;
        const snap = readSnapshot(storageKey);
        if (r.lcCount === 0 && r.store !== "db" && snap && snap.lcCount > 0) {
          setData(snap);
          setFromSnapshot(true);
        } else {
          setData(r);
          setFromSnapshot(false);
          if (storageKey && r.lcCount > 0) {
            try {
              localStorage.setItem(storageKey, JSON.stringify(r));
            } catch {
              // storage full / disabled — ignore
            }
          }
        }
      } catch (e) {
        if (cancelled) return;
        const snap = readSnapshot(storageKey);
        if (snap) {
          setData(snap);
          setFromSnapshot(true);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reqKey, storageKey]);

  if (loading) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
        Loading skill mastery…
      </section>
    );
  }
  if (error) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        {error}
      </section>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4" data-testid="lc-mastery">
      {showRootGaps && <RootGapPanel reports={data.rootGaps} />}
      {showHeatmap && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{title}</h2>
            <span className="text-[11px] text-zinc-500">
              {data.mode === "learner" ? "All sessions for this learner" : "This session only"} ·{" "}
              {data.store === "db"
                ? "saved"
                : data.store === "memory"
                  ? "temporary (no database)"
                  : "from this diagnostic"}
              {fromSnapshot ? " · browser snapshot" : ""}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Each square is a learning component, grouped by standard. Colour = mastery
            (red → green); faded squares have fewer than {data.thresholds.insufficientBelowN} answers.
            Hover for correct/wrong counts. Mastered: ≥{Math.round(data.thresholds.masteredMinMean * 100)}% with ≥
            {data.thresholds.masteredMinN} answers · Gap: &lt;{Math.round(data.thresholds.gapMaxMean * 100)}% with ≥
            {data.thresholds.gapMinN}, or every answer wrong.
          </p>
          {data.mode === "learner" && aggregationNote && (
            <p
              className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-900"
              data-testid="aggregation-note"
            >
              {aggregationNote}
            </p>
          )}
          {data.heatmap.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No answers yet — finish a diagnostic while signed in.
            </p>
          ) : (
            <MasteryHeatmap rows={data.heatmap} />
          )}
          <Legend />
        </section>
      )}
    </div>
  );
}

export function MasteryHeatmap({ rows }: { rows: HeatmapRow[] }) {
  return (
    <div className="mt-4 space-y-2" role="table" aria-label="Mastery heatmap by standard and learning component">
      {rows.map((row) => (
        <div
          key={row.standardId}
          role="row"
          className="grid grid-cols-[minmax(7rem,10rem)_1fr] items-center gap-3 rounded-lg border border-zinc-100 px-3 py-2"
        >
          <div role="rowheader" title={`${row.description}\n${cellTooltip(row.code ?? "Standard", row.summary)}`}>
            <p className="truncate font-mono text-xs font-semibold text-zinc-800">
              {row.code ?? "—"}
            </p>
            <span
              className={`mt-0.5 inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATE_CHIP[row.summary.state]}`}
            >
              {STATE_LABEL[row.summary.state]} · {Math.round(row.summary.mean * 100)}%
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {row.cells.map((c) => {
              const faded = c.summary.state === "insufficient";
              return (
                <div
                  key={c.lcId}
                  role="cell"
                  tabIndex={0}
                  aria-label={cellTooltip(c.description, c.summary).replace(/\n/g, ". ")}
                  title={cellTooltip(c.description, c.summary)}
                  data-state={c.summary.state}
                  className={`h-7 w-7 rounded-md ${faded ? "border border-dashed border-zinc-400" : "border border-white/40"}`}
                  style={{
                    backgroundColor: masteryColor(c.summary.mean),
                    opacity: faded ? 0.35 : 1,
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-600">
      {[0, 0.25, 0.5, 0.75, 1].map((m) => (
        <span key={m} className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: masteryColor(m) }} />
          {Math.round(m * 100)}%
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span
          className="inline-block h-3 w-3 rounded-sm border border-dashed border-zinc-400"
          style={{ backgroundColor: masteryColor(0.5), opacity: 0.35 }}
        />
        not enough data
      </span>
    </div>
  );
}

export function RootGapPanel({ reports }: { reports: RootGapReport[] }) {
  if (!reports.length) return null;
  return (
    <section
      className="rounded-2xl border border-orange-200 bg-orange-50/50 p-5"
      data-testid="root-gap"
    >
      <h2 className="text-lg font-semibold text-zinc-900">Foundation first</h2>
      <p className="mt-1 text-xs text-zinc-600">
        For each gap we look back through earlier standards (Learning Commons links
        first; a guessed link at most one step; never more than 2 grades lower) and
        pick the nearest earlier skill that you answered and still have a gap in. If
        the earlier skills have no answers yet, we suggest a quick check instead of a
        review.
      </p>
      <ul className="mt-3 space-y-3">
        {reports.map((r) => (
          <li
            key={`${r.kind}-${r.root?.standardId ?? "check"}-${r.target.standardId}`}
            data-kind={r.kind}
            className="rounded-xl border border-orange-100 bg-white px-4 py-3"
          >
            <p className="text-sm font-semibold text-orange-950">{r.suggestion}</p>
            {r.root ? (
              <p className="mt-1 text-xs text-zinc-600" title={r.root.description}>
                {r.root.lcDescription ?? r.root.description}
              </p>
            ) : (
              <p className="mt-1 text-xs text-zinc-600">
                No answers yet on {r.checkPrereqs.map((c) => c.label).join(", ")} (the
                skills right before {r.target.label}). Answer the quick check below first.
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
              {r.path
                .slice()
                .reverse()
                .map((p, i, arr) => (
                  <span key={p.standardId} className="inline-flex items-center gap-1">
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono">{p.label}</span>
                    {i < arr.length - 1 && <span className="text-zinc-400">→</span>}
                  </span>
                ))}
              <span
                className={`ml-2 rounded-full border px-2 py-0.5 font-semibold ${
                  r.dataSource === "real"
                    ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                    : "border-amber-300 bg-amber-50 text-amber-900"
                }`}
                title={
                  r.dataSource === "real"
                    ? "Prerequisite path from the Learning Commons Knowledge Graph (buildsTowards / standard alignment)"
                    : "No Knowledge Graph link found: prerequisite guessed as same domain, one grade lower"
                }
              >
                {r.dataSource === "real" ? "Learning Commons progression" : "Heuristic (same domain, lower grade)"}
              </span>
              {r.root && (
                <span className="text-zinc-500">
                  · root: {STATE_LABEL[r.root.state]}
                  {r.root.n > 0 ? ` (${Math.round(r.root.mean * 100)}%, n=${fmt(r.root.n)})` : ""}
                </span>
              )}
            </div>
            {r.diagnostics.length > 0 && (
              <div className="mt-2 rounded-lg bg-zinc-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Quick check (no data yet)
                </p>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs text-zinc-700">
                  {r.diagnostics.map((d, i) => (
                    <li key={`${d.lcId}-${i}`}>{d.prompt}</li>
                  ))}
                </ol>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
