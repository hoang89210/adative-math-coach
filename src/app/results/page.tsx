"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  CoachPriority,
  GradeResult,
  PracticeQuestion,
  Roadmap,
  StudySheet,
} from "@/lib/types/quiz";
import type {
  CfuCheck,
  CfuInterpretation,
  DiffGroup,
  DifferentiationPackage,
} from "@/lib/types/skills";

type CoverageSnap = {
  overallPct: number;
  domainCoverage?: Array<{ domain: string; pct: number; hit: number; total: number }>;
  holes?: Array<{ label: string; detail: string }>;
};

type ResultsPayload = {
  sessionId: string;
  result: GradeResult;
  roadmap: Roadmap;
  coverage?: CoverageSnap | null;
};

type ActivePanel =
  | {
      kind: "quiz";
      componentId: string;
      skill: string;
      questions: PracticeQuestion[];
    }
  | { kind: "sheet"; componentId: string; skill: string; sheet: StudySheet }
  | { kind: "cfu"; componentId: string; cfu: CfuCheck }
  | {
      kind: "diff";
      componentId: string;
      pack: DifferentiationPackage;
      selectedGroup: DiffGroup;
    };

function readResults(): ResultsPayload | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem("resultsPayload");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ResultsPayload;
  } catch {
    return null;
  }
}

function tierStyle(priority: CoachPriority["priority"]) {
  if (priority === "high") return "bg-rose-50 text-rose-800 border-rose-100";
  if (priority === "medium")
    return "bg-amber-50 text-amber-900 border-amber-100";
  return "bg-zinc-100 text-zinc-700 border-zinc-200";
}

function answersMatch(correct: string, given: string) {
  const a = given.trim().toLowerCase().replace(/\s+/g, " ");
  const c = correct.trim().toLowerCase().replace(/\s+/g, " ");
  if (!a) return false;
  if (a === c) return true;
  if (/^[a-d]$/.test(a) && c.startsWith(`${a})`)) return true;
  return false;
}

export default function ResultsPage() {
  const router = useRouter();
  const [data] = useState<ResultsPayload | null>(() => readResults());
  const [missing] = useState(() => {
    if (typeof window === "undefined") return false;
    return readResults() === null;
  });
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [panel, setPanel] = useState<ActivePanel | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizChecked, setQuizChecked] = useState(false);
  const [cfuAnswers, setCfuAnswers] = useState<Record<string, string>>({});
  const [cfuInterp, setCfuInterp] = useState<CfuInterpretation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journey, setJourney] = useState<{
    currentGrade: string;
    percent: number | null;
    motivation: string;
    gaps: Array<{ skill: string; priority: string }>;
    strengths: string[];
    nodes: Array<{
      grade: string;
      standardCount: number;
      domains: Array<{ id: string; label: string; count: number }>;
      phase: "past" | "now" | "future";
      isCurrent: boolean;
    }>;
  } | null>(null);

  if (missing) {
    router.replace("/");
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-500">
        Loading results…
      </main>
    );
  }

  const { result, roadmap, sessionId, coverage } = data;
  const shortCode = sessionId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const teacherBase = `/teacher?session=${encodeURIComponent(sessionId)}`;

  async function copyTeacherLink() {
    try {
      const url = `${window.location.origin}${teacherBase}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function loadJourney() {
    setJourneyOpen(true);
    if (journey) return;
    setJourneyLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/journey?sessionId=${encodeURIComponent(sessionId)}&grade=${encodeURIComponent(result.grade)}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Journey failed");
      setJourney(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setJourneyLoading(false);
    }
  }

  const priorities: CoachPriority[] =
    roadmap.priorities ??
    (roadmap.steps ?? []).map((s, i) => ({
      order: s.step ?? i + 1,
      componentId: s.componentId,
      skill: s.title || s.description,
      whyNow: s.description,
      masteryLooksLike: "Show consistent accuracy on this skill.",
      studyMoves: ["Review a worked example", "Try a similar problem alone"],
      dependsOn: [],
      priority: (i < 2 ? "high" : i < 4 ? "medium" : "later") as
        | "high"
        | "medium"
        | "later",
      standardCodes: [],
    }));

  function resetTransient() {
    setError(null);
    setQuizAnswers({});
    setQuizChecked(false);
    setCfuAnswers({});
    setCfuInterp(null);
  }

  async function loadQuiz(p: CoachPriority) {
    const key = `quiz:${p.componentId}`;
    setLoadingKey(key);
    resetTransient();
    setPanel(null);
    try {
      const res = await fetch("/api/practice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          componentId: p.componentId,
          mode: "quiz",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Quiz generation failed");
      setPanel({
        kind: "quiz",
        componentId: p.componentId,
        skill: json.description || p.skill,
        questions: json.questions,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingKey(null);
    }
  }

  async function loadSheet(p: CoachPriority) {
    const key = `sheet:${p.componentId}`;
    setLoadingKey(key);
    resetTransient();
    setPanel(null);
    try {
      const res = await fetch("/api/study-sheet/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, componentId: p.componentId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Study sheet failed");
      setPanel({
        kind: "sheet",
        componentId: p.componentId,
        skill: json.skill || p.skill,
        sheet: json.sheet,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingKey(null);
    }
  }

  async function loadCfu(p: CoachPriority) {
    const key = `cfu:${p.componentId}`;
    setLoadingKey(key);
    resetTransient();
    setPanel(null);
    try {
      const res = await fetch("/api/cfu/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, componentId: p.componentId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "CFU generation failed");
      setPanel({
        kind: "cfu",
        componentId: p.componentId,
        cfu: json.cfu,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingKey(null);
    }
  }

  async function interpretCfu(componentId: string) {
    setLoadingKey(`cfu-int:${componentId}`);
    setError(null);
    try {
      const res = await fetch("/api/cfu/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          componentId,
          answers: Object.entries(cfuAnswers).map(([itemId, answer]) => ({
            itemId,
            answer,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Interpret failed");
      setCfuInterp(json.interpretations);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingKey(null);
    }
  }

  async function loadDiff(p: CoachPriority) {
    const key = `diff:${p.componentId}`;
    setLoadingKey(key);
    resetTransient();
    setPanel(null);
    try {
      const res = await fetch("/api/differentiate/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, componentId: p.componentId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Differentiation failed");
      setPanel({
        kind: "diff",
        componentId: p.componentId,
        pack: json.pack,
        selectedGroup: "B",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <div className="space-y-2">
        <p className="text-sm text-zinc-500">Grade {result.grade} results</p>
        <h1 className="text-3xl font-semibold text-zinc-900">
          You scored {result.score}/{result.total} ({result.percent}%)
        </h1>
        <p className="leading-relaxed text-zinc-600">{roadmap.summary}</p>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <span className="rounded-lg bg-zinc-100 px-2.5 py-1 font-mono text-xs font-semibold text-zinc-800">
            Code {shortCode}
          </span>
          <Link
            href={teacherBase}
            className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Teacher view
          </Link>
          <button
            type="button"
            onClick={() => copyTeacherLink()}
            className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900"
          >
            {copied ? "Link copied" : "Copy teacher link"}
          </button>
          <button
            type="button"
            onClick={() => loadJourney()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            {journeyOpen ? "Learning journey" : "See my learning journey (K–12)"}
          </button>
          <span className="text-[11px] text-zinc-500">
            Share with a teacher or helper
          </span>
        </div>
      </div>

      {journeyOpen && (
        <section className="rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50 to-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">
                Your K–12 math journey
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                {journeyLoading
                  ? "Loading your path…"
                  : journey?.motivation}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setJourneyOpen(false)}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-800"
            >
              Hide
            </button>
          </div>

          {journey && (
            <>
              {journey.gaps.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                    Focus now (grade {journey.currentGrade})
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">
                    {journey.gaps.map((g) => (
                      <li key={g.skill}>
                        <span className="font-medium">{g.skill}</span>
                        <span className="ml-2 text-[10px] uppercase text-amber-700">
                          {g.priority}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-5 flex gap-3 overflow-x-auto pb-2">
                {journey.nodes.map((node) => (
                  <div
                    key={node.grade}
                    className={`min-w-[140px] max-w-[160px] shrink-0 rounded-2xl border px-3 py-3 ${
                      node.isCurrent
                        ? "border-indigo-600 bg-indigo-600 text-white shadow-lg"
                        : node.phase === "past"
                          ? "border-zinc-200 bg-zinc-50 text-zinc-500"
                          : "border-indigo-100 bg-white text-zinc-800"
                    }`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                      {node.isCurrent
                        ? "You are here"
                        : node.phase === "past"
                          ? "Foundation"
                          : "Ahead"}
                    </p>
                    <p className="mt-1 text-lg font-bold">
                      {node.grade === "K" ? "K" : `Grade ${node.grade}`}
                    </p>
                    <p
                      className={`mt-1 text-[10px] ${
                        node.isCurrent ? "text-indigo-100" : "text-zinc-500"
                      }`}
                    >
                      {node.standardCount} standards in catalog
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {node.domains.slice(0, 4).map((d) => (
                        <span
                          key={d.id}
                          className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                            node.isCurrent
                              ? "bg-white/20 text-white"
                              : "bg-zinc-100 text-zinc-700"
                          }`}
                          title={d.label}
                        >
                          {d.id}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-center text-sm font-medium text-indigo-900">
                Close today’s gaps → unlock stronger moves through grade 12.
              </p>
            </>
          )}
        </section>
      )}

      {coverage && (
        <section className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-6">
          <h2 className="text-lg font-semibold text-zinc-900">
            Coverage snapshot
          </h2>
          <p className="mt-1 text-sm text-zinc-700">
            You showed mastery on about{" "}
            <strong>{coverage.overallPct}%</strong> of the skills sampled in
            this diagnostic.
          </p>
          {coverage.domainCoverage && coverage.domainCoverage.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {coverage.domainCoverage.slice(0, 8).map((d) => (
                <span
                  key={d.domain}
                  className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 border border-emerald-100"
                >
                  {d.domain} {d.pct}%
                </span>
              ))}
            </div>
          )}
          {coverage.holes && coverage.holes.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700">
              {coverage.holes.slice(0, 5).map((h) => (
                <li key={h.label}>
                  {h.label}{" "}
                  <span className="text-xs text-zinc-500">({h.detail})</span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/progress"
            className="mt-3 inline-block text-sm font-medium text-emerald-800 underline"
          >
            View long-term progress →
          </Link>
        </section>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Skill breakdown</h2>
        <ul className="space-y-3">
          {result.byComponent.map((c) => (
            <li
              key={c.componentId}
              className="flex items-start justify-between gap-4 rounded-xl border border-zinc-100 px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  {c.description}
                </p>
                <p className="text-xs text-zinc-500">
                  {c.correct}/{c.total} correct
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  c.mastered
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-800"
                }`}
              >
                {c.mastered ? "Strong" : "Needs work"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Learning plan</h2>
          <span className="text-xs font-medium uppercase tracking-wide text-indigo-600">
            Direction first
          </span>
        </div>
        <p className="mb-5 text-sm text-zinc-500">
          Optional tools per step: quick quiz, check for understanding, study
          sheet, or leveled practice (A/B/C).
        </p>

        <ol className="space-y-4">
          {priorities.map((p) => {
            const active =
              panel && panel.componentId === p.componentId ? panel.kind : null;
            return (
              <li
                key={`${p.order}-${p.componentId}`}
                className="rounded-xl border border-zinc-100 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                    Step {p.order}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tierStyle(p.priority)}`}
                  >
                    {p.priority}
                  </span>
                </div>
                <p className="mt-2 font-medium text-zinc-900">{p.skill}</p>
                <p className="mt-2 text-sm text-zinc-600">
                  <span className="font-semibold text-zinc-800">Why now: </span>
                  {p.whyNow}
                </p>
                <p className="mt-2 text-sm text-zinc-600">
                  <span className="font-semibold text-zinc-800">
                    Mastery looks like:{" "}
                  </span>
                  {p.masteryLooksLike}
                </p>
                {p.dependsOn && p.dependsOn.length > 0 && (
                  <p className="mt-2 rounded-lg bg-sky-50 px-2 py-1 text-xs text-sky-900">
                    <span className="font-semibold">Coherence · builds on: </span>
                    {p.dependsOn.join(" · ")}
                  </p>
                )}
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700">
                  {p.studyMoves.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!!loadingKey}
                    onClick={() => loadQuiz(p)}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${
                      active === "quiz" ? "bg-indigo-700" : "bg-indigo-600"
                    }`}
                  >
                    {loadingKey === `quiz:${p.componentId}`
                      ? "Making quiz…"
                      : "Try a quick quiz"}
                  </button>
                  <button
                    type="button"
                    disabled={!!loadingKey}
                    onClick={() => loadCfu(p)}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50 ${
                      active === "cfu"
                        ? "bg-teal-700 text-white"
                        : "bg-teal-600 text-white"
                    }`}
                  >
                    {loadingKey === `cfu:${p.componentId}`
                      ? "Making check…"
                      : "Check understanding"}
                  </button>
                  <button
                    type="button"
                    disabled={!!loadingKey}
                    onClick={() => loadSheet(p)}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${
                      active === "sheet"
                        ? "border-indigo-600 bg-indigo-50 text-indigo-900"
                        : "border-zinc-300 bg-white text-zinc-800"
                    }`}
                  >
                    {loadingKey === `sheet:${p.componentId}`
                      ? "Making sheet…"
                      : "Study sheet"}
                  </button>
                  <button
                    type="button"
                    disabled={!!loadingKey}
                    onClick={() => loadDiff(p)}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${
                      active === "diff"
                        ? "border-violet-600 bg-violet-50 text-violet-900"
                        : "border-zinc-300 bg-white text-zinc-800"
                    }`}
                  >
                    {loadingKey === `diff:${p.componentId}`
                      ? "Making levels…"
                      : "Leveled practice A/B/C"}
                  </button>
                </div>

                <details className="mt-3 rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2 text-xs text-violet-950">
                  <summary className="cursor-pointer font-semibold">
                    For teacher
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      href={`${teacherBase}&skill=${encodeURIComponent(p.componentId)}&action=lesson`}
                      className="rounded-md bg-violet-700 px-2 py-1 font-semibold text-white"
                    >
                      Build lesson
                    </Link>
                    <Link
                      href={`${teacherBase}&skill=${encodeURIComponent(p.componentId)}&action=prep`}
                      className="rounded-md border border-violet-300 bg-white px-2 py-1 font-semibold"
                    >
                      Prep to teach
                    </Link>
                    <Link
                      href={`${teacherBase}&skill=${encodeURIComponent(p.componentId)}&action=cfu`}
                      className="rounded-md border border-teal-300 bg-white px-2 py-1 font-semibold"
                    >
                      CFU guide
                    </Link>
                    <Link
                      href={`${teacherBase}&skill=${encodeURIComponent(p.componentId)}&action=diff`}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 font-semibold"
                    >
                      Diff plan
                    </Link>
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </section>

      {panel?.kind === "quiz" && (
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-6">
          <h2 className="text-lg font-semibold text-zinc-900">Quick quiz</h2>
          <p className="mt-1 text-sm text-zinc-600">{panel.skill}</p>
          <div className="mt-4 space-y-4">
            {panel.questions.map((q, i) => {
              const given = quizAnswers[q.id] ?? "";
              const ok = quizChecked && answersMatch(q.correct_answer, given);
              const bad =
                quizChecked && given && !answersMatch(q.correct_answer, given);
              return (
                <div
                  key={q.id}
                  className="rounded-xl border border-zinc-200 bg-white p-4"
                >
                  <p className="text-sm font-medium text-zinc-900">
                    {i + 1}. {q.question}
                  </p>
                  {q.type === "multiple_choice" && q.options?.length ? (
                    <div className="mt-3 space-y-2">
                      {q.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          disabled={quizChecked}
                          onClick={() =>
                            setQuizAnswers((prev) => ({
                              ...prev,
                              [q.id]: opt,
                            }))
                          }
                          className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${
                            given === opt
                              ? "border-indigo-600 bg-indigo-50"
                              : "border-zinc-200"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      disabled={quizChecked}
                      value={given}
                      onChange={(e) =>
                        setQuizAnswers((prev) => ({
                          ...prev,
                          [q.id]: e.target.value,
                        }))
                      }
                      className="mt-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                      placeholder="Your answer"
                    />
                  )}
                  {quizChecked && (
                    <p
                      className={`mt-2 text-xs ${
                        ok
                          ? "text-emerald-700"
                          : bad
                            ? "text-rose-700"
                            : "text-zinc-600"
                      }`}
                    >
                      {ok ? "Correct. " : "Not quite. "}
                      Answer: <strong>{q.correct_answer}</strong>
                      {q.explanation ? ` — ${q.explanation}` : ""}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {!quizChecked ? (
            <button
              type="button"
              onClick={() => setQuizChecked(true)}
              className="mt-4 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Check answers
            </button>
          ) : (
            <p className="mt-4 text-sm text-emerald-800">
              Nice work. Use Check understanding if you want insight into your
              reasoning path.
            </p>
          )}
        </section>
      )}

      {panel?.kind === "cfu" && (
        <section className="rounded-2xl border border-teal-200 bg-teal-50/40 p-6">
          <h2 className="text-lg font-semibold text-zinc-900">
            Check for understanding
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Focus: {panel.cfu.focus} · Rigor: {panel.cfu.rigor}
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Short formative check (1–3 items). After you answer, we show what
            your choice suggests and a next study move.
          </p>
          <div className="mt-4 space-y-4">
            {panel.cfu.items.map((item, i) => {
              const given = cfuAnswers[item.id] ?? "";
              const interp = cfuInterp?.find((x) => x.itemId === item.id);
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-zinc-200 bg-white p-4"
                >
                  <p className="text-sm font-medium text-zinc-900">
                    {i + 1}. {item.stem}
                  </p>
                  {item.type === "multiple_choice" && item.options?.length ? (
                    <div className="mt-3 space-y-2">
                      {item.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          disabled={!!cfuInterp}
                          onClick={() =>
                            setCfuAnswers((prev) => ({
                              ...prev,
                              [item.id]: opt,
                            }))
                          }
                          className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${
                            given === opt
                              ? "border-teal-600 bg-teal-50"
                              : "border-zinc-200"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      disabled={!!cfuInterp}
                      value={given}
                      onChange={(e) =>
                        setCfuAnswers((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                      className="mt-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                      placeholder="Your answer"
                    />
                  )}
                  {interp && (
                    <div className="mt-3 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-950">
                      <p>
                        <span className="font-semibold">
                          {interp.isCorrect
                            ? "On track. "
                            : "Useful signal. "}
                        </span>
                        {interp.feedback}
                      </p>
                      {interp.matchedRoute && (
                        <p className="mt-1 text-teal-800">
                          What this shows: {interp.matchedRoute.reveals}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!cfuInterp ? (
            <button
              type="button"
              disabled={
                !!loadingKey ||
                panel.cfu.items.some((it) => !cfuAnswers[it.id])
              }
              onClick={() => interpretCfu(panel.componentId)}
              className="mt-4 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loadingKey?.startsWith("cfu-int:")
                ? "Reading responses…"
                : "See what this shows"}
            </button>
          ) : (
            <p className="mt-4 text-sm text-teal-900">
              Use the next steps above, or open a study sheet / leveled practice
              for more support.
            </p>
          )}
        </section>
      )}

      {panel?.kind === "sheet" && (
        <section className="rounded-2xl border border-violet-200 bg-violet-50/30 p-6">
          <h2 className="text-lg font-semibold text-zinc-900">
            {panel.sheet.title}
          </h2>
          <p className="mt-1 text-sm text-zinc-600">{panel.sheet.skillSummary}</p>
          <div className="mt-4 space-y-4 text-sm text-zinc-800">
            <div>
              <h3 className="font-semibold text-zinc-900">Key idea</h3>
              <p className="mt-1 leading-relaxed">{panel.sheet.keyIdea}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <h3 className="font-semibold text-zinc-900">Worked example</h3>
              <p className="mt-2">
                <span className="font-medium">Problem: </span>
                {panel.sheet.workedExample.problem}
              </p>
              <p className="mt-2 whitespace-pre-wrap">
                <span className="font-medium">Solution: </span>
                {panel.sheet.workedExample.solution}
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-zinc-900">Watch out for</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {panel.sheet.commonMistakes.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-zinc-900">Try on your own</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {panel.sheet.tryOnYourOwnTips.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
            <p className="rounded-lg bg-white/80 px-3 py-2 text-sm text-indigo-900">
              {panel.sheet.encouragement}
            </p>
          </div>
        </section>
      )}

      {panel?.kind === "diff" && (
        <section className="rounded-2xl border border-violet-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-900">
            Leveled practice
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            From study sheet: {panel.pack.sourceSheetTitle}
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            {panel.pack.teacherPlanLite.flexibleGroupingNote}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {panel.pack.tiers.map((t) => (
              <button
                key={t.group}
                type="button"
                onClick={() =>
                  setPanel({
                    ...panel,
                    selectedGroup: t.group,
                  })
                }
                className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                  panel.selectedGroup === t.group
                    ? "bg-violet-700 text-white"
                    : "border border-zinc-300 bg-zinc-50 text-zinc-800"
                }`}
              >
                {t.title}
              </button>
            ))}
          </div>

          {(() => {
            const tier =
              panel.pack.tiers.find((t) => t.group === panel.selectedGroup) ??
              panel.pack.tiers[0];
            if (!tier) return null;
            return (
              <div className="mt-5 space-y-3">
                <p className="text-sm font-medium text-zinc-900">{tier.intro}</p>
                <ol className="space-y-3">
                  {tier.tasks.map((task, idx) => (
                    <li
                      key={task.id}
                      className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-zinc-800"
                    >
                      <p className="font-medium">
                        {idx + 1}. {task.prompt}
                      </p>
                      {task.supportNote && (
                        <p className="mt-1 text-xs text-zinc-500">
                          Help: {task.supportNote}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
                {tier.exitCheck && (
                  <p className="text-sm text-zinc-700">
                    <span className="font-semibold">Check your thinking: </span>
                    {tier.exitCheck}
                  </p>
                )}
                {tier.ifYouFinishEarly && (
                  <p className="text-sm text-zinc-700">
                    <span className="font-semibold">If you finish early: </span>
                    {tier.ifYouFinishEarly}
                  </p>
                )}
              </div>
            );
          })()}

          <details className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-600">
            <summary className="cursor-pointer font-semibold text-zinc-800">
              For helpers (optional)
            </summary>
            <p className="mt-2">{panel.pack.teacherPlanLite.standardGist}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {panel.pack.teacherPlanLite.whyThisWorks.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {roadmap.strengthsToKeep && roadmap.strengthsToKeep.length > 0 && (
        <section className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-6">
          <h2 className="text-lg font-semibold text-zinc-900">
            Strengths to keep warm
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700">
            {roadmap.strengthsToKeep.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {roadmap.nextCheckpoint && (
        <section className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-indigo-700">
            Next checkpoint
          </h2>
          <p className="mt-2 text-sm text-zinc-800">{roadmap.nextCheckpoint}</p>
        </section>
      )}

      <Link
        href="/"
        className="text-sm font-medium text-indigo-600 hover:underline"
      >
        ← Start another diagnostic
      </Link>
    </main>
  );
}
