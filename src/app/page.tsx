"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8"];

export default function Home() {
  const router = useRouter();
  const [grade, setGrade] = useState("4");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDiagnostic() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnostic/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate test");
      sessionStorage.setItem("diagnosticTest", JSON.stringify(data));
      router.push("/test");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-10 px-6 py-16">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-indigo-600">
          Adaptive Math Coach
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900">
          Three roles. One learning system.
        </h1>
        <p className="text-lg text-zinc-600">
          Student learns · Teacher plans · Quality Lab checks content quality
          (Giáo vụ).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
            Student
          </p>
          <p className="mt-2 text-sm text-zinc-700">
            Diagnostic, learning plan, quiz, CFU, study sheet, A/B/C practice.
          </p>
          <p className="mt-4 text-xs text-zinc-500">Start below ↓</p>
        </div>
        <Link
          href="/teacher"
          className="rounded-2xl border-2 border-violet-200 bg-violet-50/50 p-5 transition hover:border-violet-400"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
            Teacher
          </p>
          <p className="mt-2 text-sm text-zinc-700">
            Open a student session · build lesson · prep to teach · CFU/diff
            guides.
          </p>
          <p className="mt-4 text-sm font-semibold text-violet-800">
            Open Teacher →
          </p>
        </Link>
        <Link
          href="/lab"
          className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-5 transition hover:border-amber-400"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Quality Lab
          </p>
          <p className="mt-2 text-sm text-zinc-700">
            Giáo vụ QA · math standards alignment · grade-level check. Not a
            classroom teacher screen.
          </p>
          <p className="mt-4 text-sm font-semibold text-amber-900">
            Open Quality Lab →
          </p>
        </Link>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">
          Student · start diagnostic
        </h2>
        <label className="mb-3 mt-4 block text-sm font-medium text-zinc-700">
          Grade level
        </label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {GRADES.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrade(g)}
              className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                grade === g
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-zinc-200 bg-zinc-50 text-zinc-800 hover:border-indigo-300"
              }`}
            >
              {g === "K" ? "K" : `Grade ${g}`}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={startDiagnostic}
          className="mt-6 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Generating diagnostic…" : "Start diagnostic test"}
        </button>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
