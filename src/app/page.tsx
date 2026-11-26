"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiKeyPanel } from "@/components/ApiKeyPanel";
import { apiErrorMessage, apiFetch, getStoredOpenAiKey, isUsingServerTestKey } from "@/lib/client-api-key";
import { GRADE_BANDS, GRADES_K12, gradeLabel } from "@/lib/grades";

export default function Home() {
  const router = useRouter();
  const [bandId, setBandId] = useState("3-5");
  const [grade, setGrade] = useState("4");
  const [jurisdiction, setJurisdiction] = useState("Multi-State");
  const [learnerId, setLearnerId] = useState<string | null>(null);
  const [learnerToken, setLearnerToken] = useState<string | null>(null);
  const [learnerCode, setLearnerCode] = useState("");
  const [learnerPin, setLearnerPin] = useState("");
  const [learnerMsg, setLearnerMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bandGrades = useMemo(() => {
    const band = GRADE_BANDS.find((b) => b.id === bandId);
    return band ? [...band.grades] : [...GRADES_K12];
  }, [bandId]);

  function selectBand(id: string) {
    setBandId(id);
    const band = GRADE_BANDS.find((b) => b.id === id);
    if (band && !band.grades.includes(grade as (typeof band.grades)[number])) {
      setGrade(band.grades[Math.floor(band.grades.length / 2)] ?? band.grades[0]);
    }
  }

  async function startDiagnostic() {
    setLoading(true);
    setError(null);
    try {
      if (!getStoredOpenAiKey() && !isUsingServerTestKey()) {
        const cont = window.confirm(
          "No OpenAI key saved on this device. Continue anyway? (AI questions need a key — paste one in the yellow box above, or the server key if configured.)",
        );
        if (!cont) {
          setLoading(false);
          return;
        }
      }
      const res = await apiFetch("/api/diagnostic/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade, jurisdiction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(data, "Failed to generate test"));
      sessionStorage.setItem(
        "diagnosticTest",
        JSON.stringify({
          ...data,
          jurisdiction,
          learnerId: learnerId || undefined,
        }),
      );
      if (learnerId) sessionStorage.setItem("learnerId", learnerId);
      if (learnerToken) sessionStorage.setItem("learnerToken", learnerToken);
      if (learnerCode) sessionStorage.setItem("learnerCode", learnerCode);
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
          (Giáo vụ). Math diagnostic covers <strong>K–12</strong>.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
            Student
          </p>
          <p className="mt-2 text-sm text-zinc-700">
            K–12 diagnostic, learning plan, quiz, CFU, study sheet, A/B/C
            practice, journey map.
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
            Giáo vụ QA · math standards alignment · grade-level check.
          </p>
          <p className="mt-4 text-sm font-semibold text-amber-900">
            Open Quality Lab →
          </p>
        </Link>
      </div>

      <ApiKeyPanel />

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">
          Student · start diagnostic (K–12)
        </h2>

        <label className="mb-2 mt-4 block text-sm font-medium text-zinc-700">
          Grade band
        </label>
        <div className="flex flex-wrap gap-2">
          {GRADE_BANDS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => selectBand(b.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                bandId === b.id
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-indigo-300"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>

        <label className="mb-2 mt-5 block text-sm font-medium text-zinc-700">
          Standards jurisdiction
        </label>
        <select
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value)}
          className="mb-4 w-full max-w-md rounded-xl border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="Multi-State">Multi-State (default)</option>
          <option value="California">California</option>
          <option value="Texas">Texas</option>
          <option value="New York">New York</option>
          <option value="Florida">Florida</option>
          <option value="Illinois">Illinois</option>
        </select>

        <div className="mb-5 rounded-xl border border-zinc-100 bg-zinc-50 p-4">
          <p className="text-sm font-medium text-zinc-800">
            Learner profile (optional — long-term mastery)
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={learnerPin}
              onChange={(e) => setLearnerPin(e.target.value)}
              placeholder="PIN 4–6 digits"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white"
              onClick={async () => {
                setLearnerMsg(null);
                try {
                  const res = await fetch("/api/learners", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "create",
                      pin: learnerPin,
                      grade,
                      jurisdiction,
                    }),
                  });
                  const j = await res.json();
                  if (!res.ok) throw new Error(apiErrorMessage(j, "Create failed"));
                  setLearnerId(j.learnerId);
                  setLearnerToken(j.learnerToken ?? null);
                  setLearnerCode(j.publicCode);
                  setLearnerMsg(
                    `Save your code ${j.publicCode} and PIN — needed to continue later.`,
                  );
                } catch (e) {
                  setLearnerMsg(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              New learner
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={learnerCode}
              onChange={(e) => setLearnerCode(e.target.value)}
              placeholder="MATH-XXXXXX"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold"
              onClick={async () => {
                setLearnerMsg(null);
                try {
                  const res = await fetch("/api/learners", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "login",
                      code: learnerCode,
                      pin: learnerPin,
                    }),
                  });
                  const j = await res.json();
                  if (!res.ok) throw new Error(apiErrorMessage(j, "Login failed"));
                  setLearnerId(j.learnerId);
                  setLearnerToken(j.learnerToken ?? null);
                  setLearnerCode(j.publicCode);
                  setLearnerMsg(`Signed in as ${j.publicCode}`);
                } catch (e) {
                  setLearnerMsg(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Continue with code
            </button>
            <Link
              href="/progress"
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-900"
            >
              Progress
            </Link>
          </div>
          {learnerMsg && (
            <p className="mt-2 text-xs text-zinc-600">{learnerMsg}</p>
          )}
        </div>

        <label className="mb-3 block text-sm font-medium text-zinc-700">
          Grade level
        </label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {bandGrades.map((g) => (
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
              {gradeLabel(g)}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={startDiagnostic}
          className="mt-6 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading
            ? `Generating ${gradeLabel(grade)} diagnostic…`
            : `Start ${gradeLabel(grade)} diagnostic`}
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
