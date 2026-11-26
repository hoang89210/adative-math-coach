"use client";

import Link from "next/link";
import { useState } from "react";
import { LcMasterySection } from "@/components/LcMasterySection";

export default function ProgressPage() {
  const [code, setCode] = useState(
    () =>
      (typeof window !== "undefined" &&
        sessionStorage.getItem("learnerCode")) ||
      "",
  );
  const [pin, setPin] = useState("");
  const [view, setView] = useState<{
    publicCode: string;
    currentGrade?: string;
    sessionCount: number;
    mastered: number;
    emerging: number;
    coverageHistory: Array<{
      at: string;
      grade: string;
      overallPct: number;
      sessionId: string;
    }>;
    recentMastery: Array<{
      componentId: string;
      status: string;
      correct: number;
      attempts: number;
      lastAt: string;
      lastGrade: string;
    }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [learnerId, setLearnerId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/learners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", code, pin }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setView(j.view);
      setLearnerId(j.learnerId);
      sessionStorage.setItem("learnerId", j.learnerId);
      sessionStorage.setItem("learnerCode", j.publicCode);
    } catch (e) {
      setView(null);
      setLearnerId(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-6 py-12">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
          Long-term mastery
        </p>
        <h1 className="text-3xl font-semibold text-zinc-900">Your progress</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Sign in with learner code + PIN to see mastery across diagnostics.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="MATH-XXXXXX"
            className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
          />
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            type="password"
            className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => load()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Open progress"}
          </button>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}
      </div>

      {view && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5">
            <p className="font-mono text-lg font-semibold text-indigo-950">
              {view.publicCode}
            </p>
            <p className="mt-1 text-sm text-zinc-700">
              Grade focus: {view.currentGrade ?? "—"} · Sessions:{" "}
              {view.sessionCount} · Mastered skills: {view.mastered} · Emerging:{" "}
              {view.emerging}
            </p>
          </div>

          {learnerId && (
            <LcMasterySection
              request={{ learnerId }}
              storageKey={`amc.lcMastery.v1.${learnerId}`}
            />
          )}

          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold">Coverage history</h2>
            {view.coverageHistory.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">
                No coverage snapshots yet — finish a diagnostic while signed in.
              </p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {view.coverageHistory
                  .slice()
                  .reverse()
                  .map((c) => (
                    <li
                      key={`${c.sessionId}-${c.at}`}
                      className="flex justify-between rounded-lg border border-zinc-100 px-3 py-2"
                    >
                      <span>
                        Grade {c.grade} · {new Date(c.at).toLocaleString()}
                      </span>
                      <span className="font-semibold">{c.overallPct}%</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold">Recent skill mastery</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {view.recentMastery.map((m) => (
                <li
                  key={m.componentId}
                  className="rounded-lg border border-zinc-100 px-3 py-2"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-mono text-xs text-zinc-500">
                      {m.componentId.slice(0, 8)}…
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        m.status === "mastered"
                          ? "text-emerald-700"
                          : "text-amber-800"
                      }`}
                    >
                      {m.status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600">
                    {m.correct}/{m.attempts} · grade {m.lastGrade} ·{" "}
                    {new Date(m.lastAt).toLocaleDateString()}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <Link href="/" className="text-sm font-medium text-indigo-600 underline">
        ← Home
      </Link>
    </main>
  );
}
