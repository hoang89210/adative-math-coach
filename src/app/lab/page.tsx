"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { StandardCategoryPicker } from "@/components/StandardCategoryPicker";
import type {
  GradeLevelResult,
  LabArtifactOption,
  MathAlignmentResult,
} from "@/lib/lab/types";

function LabInner() {
  const search = useSearchParams();
  const initialSession =
    search.get("session") || search.get("sessionId") || search.get("code") || "";
  const initialSource = search.get("source") || "";
  const initialComponent = search.get("componentId") || "";

  const [mode, setMode] = useState<"session" | "standalone">(
    initialSession ? "session" : "standalone",
  );
  const [sessionInput, setSessionInput] = useState(initialSession);
  const [artifacts, setArtifacts] = useState<LabArtifactOption[]>([]);
  const [sessionGrade, setSessionGrade] = useState("");
  const [artifactId, setArtifactId] = useState("");

  const [question, setQuestion] = useState("");
  const [statementCode, setStatementCode] = useState("");
  const [jurisdiction, setJurisdiction] = useState("Multi-State");
  const [text, setText] = useState("");
  const [targetGrade, setTargetGrade] = useState("4");

  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mathResult, setMathResult] = useState<MathAlignmentResult | null>(
    null,
  );
  const [gradeResult, setGradeResult] = useState<GradeLevelResult | null>(
    null,
  );

  const selectedArtifact = useMemo(
    () => artifacts.find((a) => a.id === artifactId) ?? null,
    [artifacts, artifactId],
  );

  async function loadArtifacts() {
    setLoading("artifacts");
    setError(null);
    setMathResult(null);
    setGradeResult(null);
    try {
      const res = await fetch(
        `/api/lab/artifacts?sessionId=${encodeURIComponent(sessionInput.trim())}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load artifacts");
      setArtifacts(json.artifacts ?? []);
      setSessionGrade(json.grade ?? "");
      if (json.grade) setTargetGrade(json.grade);

      let pick = (json.artifacts as LabArtifactOption[])[0]?.id ?? "";
      if (initialComponent || initialSource) {
        const match = (json.artifacts as LabArtifactOption[]).find((a) => {
          const compOk = initialComponent
            ? a.componentId === initialComponent
            : true;
          const srcOk = initialSource ? a.source.includes(initialSource) || a.source === initialSource : true;
          return compOk && srcOk;
        });
        if (match) pick = match.id;
      }
      setArtifactId(pick);
      if (pick) {
        const art = (json.artifacts as LabArtifactOption[]).find(
          (a) => a.id === pick,
        );
        if (art) {
          setQuestion(art.text);
          setText(art.text);
          if (art.statementCodes?.[0]) setStatementCode(art.statementCodes[0]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setArtifacts([]);
    } finally {
      setLoading(null);
    }
  }

  function onPickArtifact(id: string) {
    setArtifactId(id);
    const art = artifacts.find((a) => a.id === id);
    if (!art) return;
    setQuestion(art.text);
    setText(art.text);
    if (art.statementCodes?.[0]) setStatementCode(art.statementCodes[0]);
  }

  async function runMathAlignment() {
    setLoading("math");
    setError(null);
    setMathResult(null);
    try {
      const body =
        mode === "session" && sessionInput && artifactId
          ? {
              sessionId: sessionInput.trim(),
              artifactId,
              statement_code: statementCode || undefined,
              jurisdiction,
              question: question || undefined,
            }
          : {
              question,
              statement_code: statementCode,
              jurisdiction,
            };
      const res = await fetch("/api/lab/evaluate/math-alignment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Evaluation failed");
      setMathResult(json.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function runGradeLevel() {
    setLoading("grade");
    setError(null);
    setGradeResult(null);
    try {
      const body =
        mode === "session" && sessionInput && artifactId
          ? {
              sessionId: sessionInput.trim(),
              artifactId,
              target_grade: targetGrade || sessionGrade || undefined,
              text: text || undefined,
            }
          : { text, target_grade: targetGrade };
      const res = await fetch("/api/lab/evaluate/grade-level", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Evaluation failed");
      setGradeResult(json.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Quality Lab · Giáo vụ
          </p>
          <h1 className="text-3xl font-semibold text-zinc-900">
            Evaluate AI content quality
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">
            Academic QA module (separate from Teacher). Run Learning
            Commons–inspired evaluators: math standards alignment and grade-level
            appropriateness. Does not grade students or write lessons.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/" className="text-indigo-600 hover:underline">
            Home
          </Link>
          <Link href="/teacher" className="text-violet-700 hover:underline">
            Teacher
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("standalone")}
          className={`rounded-xl px-4 py-2 text-sm font-semibold ${
            mode === "standalone"
              ? "bg-amber-700 text-white"
              : "border border-zinc-300 bg-white text-zinc-800"
          }`}
        >
          Standalone paste
        </button>
        <button
          type="button"
          onClick={() => setMode("session")}
          className={`rounded-xl px-4 py-2 text-sm font-semibold ${
            mode === "session"
              ? "bg-amber-700 text-white"
              : "border border-zinc-300 bg-white text-zinc-800"
          }`}
        >
          From student session
        </button>
      </div>

      {mode === "session" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-zinc-900">Load session artifacts</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={sessionInput}
              onChange={(e) => setSessionInput(e.target.value)}
              placeholder="Session code or id"
              className="min-w-[220px] flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={!!loading || !sessionInput.trim()}
              onClick={() => loadArtifacts()}
              className="rounded-xl bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading === "artifacts" ? "Loading…" : "Load artifacts"}
            </button>
          </div>
          {artifacts.length > 0 && (
            <div className="mt-4">
              <label className="text-xs font-semibold uppercase text-zinc-500">
                Artifact to evaluate
              </label>
              <select
                value={artifactId}
                onChange={(e) => onPickArtifact(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              >
                {artifacts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              {selectedArtifact && (
                <p className="mt-2 line-clamp-4 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                  {selectedArtifact.text}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Math standards alignment</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Is this question aligned to the standard / learning components?
          </p>
          <label className="mt-4 block text-xs font-semibold text-zinc-600">
            Question / item text
          </label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
            placeholder="Paste assessment question…"
          />
          <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/40 p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-amber-900">
              Pick standard by category (no typing required)
            </p>
            <StandardCategoryPicker
              initialGrade={targetGrade || sessionGrade || "4"}
              onSelect={(sel) => {
                setStatementCode(sel.code);
                setTargetGrade(sel.grade);
              }}
            />
            <div className="mt-3">
              <label className="text-xs font-semibold text-zinc-600">
                Jurisdiction
              </label>
              <input
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
            {statementCode && (
              <p className="mt-2 text-xs text-zinc-600">
                Using code:{" "}
                <span className="font-mono font-semibold">{statementCode}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={!!loading || !question.trim() || !statementCode.trim()}
            onClick={() => runMathAlignment()}
            className="mt-4 rounded-xl bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading === "math" ? "Evaluating…" : "Run math alignment"}
          </button>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Grade-level appropriateness</h2>
          <p className="mt-1 text-xs text-zinc-500">
            What grade band can access this student-facing text?
          </p>
          <label className="mt-4 block text-xs font-semibold text-zinc-600">
            Text
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
            placeholder="Paste study sheet or stem language…"
          />
          <label className="mt-3 block text-xs font-semibold text-zinc-600">
            Target grade (optional fit check)
          </label>
          <input
            value={targetGrade}
            onChange={(e) => setTargetGrade(e.target.value)}
            className="mt-1 w-full max-w-[120px] rounded-xl border border-zinc-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={!!loading || !text.trim()}
            onClick={() => runGradeLevel()}
            className="mt-4 rounded-xl bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading === "grade" ? "Evaluating…" : "Run grade-level check"}
          </button>
        </section>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {mathResult && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-6">
          <h2 className="text-lg font-semibold text-zinc-900">
            Math alignment result
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            mode={mathResult.mode} · {mathResult.statement_code} ·{" "}
            {mathResult.jurisdiction}
          </p>
          <p className="mt-3 text-sm text-zinc-800">{mathResult.summary}</p>
          <p className="mt-2 text-sm font-semibold text-zinc-900">
            {mathResult.aligned_count}/{mathResult.total_count} components
            aligned
          </p>
          <ul className="mt-4 space-y-3">
            {mathResult.learning_components.map((lc) => (
              <li
                key={lc.identifier}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-zinc-900">{lc.description}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      lc.aligned
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-rose-50 text-rose-800"
                    }`}
                  >
                    {lc.aligned ? "Aligned" : "Not aligned"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-zinc-600">{lc.reasoning}</p>
                {lc.feedback && (
                  <p className="mt-2 text-xs text-amber-900">
                    Feedback: {lc.feedback}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {gradeResult && (
        <section className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-900">
            Grade-level result
          </h2>
          <p className="mt-1 text-xs text-zinc-500">mode={gradeResult.mode}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-950">
              Band {gradeResult.grade_band}
            </span>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-800">
              Alt {gradeResult.alternative_grade_band}
            </span>
            {gradeResult.target_grade && (
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-900">
                Target grade {gradeResult.target_grade}
              </span>
            )}
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-800">
            {gradeResult.reasoning}
          </p>
          <p className="mt-3 text-sm text-zinc-700">
            <span className="font-semibold">Scaffolding: </span>
            {gradeResult.scaffolding_needed}
          </p>
          {gradeResult.fit_note && (
            <p className="mt-2 text-sm text-zinc-700">
              <span className="font-semibold">Fit: </span>
              {gradeResult.fit_note}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

export default function LabPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-500">
          Loading Quality Lab…
        </main>
      }
    >
      <LabInner />
    </Suspense>
  );
}
