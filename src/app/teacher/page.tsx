"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { LcMasterySection } from "@/components/LcMasterySection";
import { ApiKeyPanel } from "@/components/ApiKeyPanel";
import { StandardCategoryPicker } from "@/components/StandardCategoryPicker";
import { apiErrorMessage, apiFetch } from "@/lib/client-api-key";
import type { TeacherLesson, TeacherPrepState } from "@/lib/types/skills";

type SkillRow = {
  componentId: string;
  order: number;
  skill: string;
  priority: string;
  whyNow: string;
  masteryLooksLike: string;
  standardCodes: string[];
  artifacts: {
    quiz: boolean;
    cfu: boolean;
    studySheet: boolean;
    differentiation: boolean;
    teacherLesson: boolean;
    teacherPrep: boolean;
  };
};

type SessionView = {
  sessionId: string;
  shortCode: string;
  grade: string;
  result: {
    score: number;
    total: number;
    percent: number;
    weakCount: number;
    strongCount: number;
    byComponent: Array<{
      componentId: string;
      description: string;
      correct: number;
      total: number;
      mastered: boolean;
    }>;
  };
  roadmapSummary: string | null;
  nextCheckpoint: string | null;
  skills: SkillRow[];
};

type CfuGuide = {
  focus: string;
  rigor: string;
  items: Array<{
    id: string;
    stem: string;
    correct_answer: string;
    options?: string[];
    responseRoutes: Array<{
      choice: string;
      reveals: string;
      nextStep: string;
    }>;
  }>;
};

type DiffPlan = {
  sourceSheetTitle: string;
  teacherPlanLite: {
    standardGist: string;
    flexibleGroupingNote: string;
    whyThisWorks: string[];
  };
  tiers: Array<{
    group: string;
    level: string;
    title: string;
    intro: string;
    tasks: Array<{ id: string; prompt: string; supportNote?: string }>;
    exitCheck?: string;
  }>;
};

function TeacherPageInner() {
  const search = useSearchParams();
  const initialSession =
    search.get("session") || search.get("sessionId") || search.get("code") || "";
  const initialSkill = search.get("skill") || search.get("componentId") || "";
  const initialAction = search.get("action") || "";

  const [codeInput, setCodeInput] = useState(initialSession);
  const [session, setSession] = useState<SessionView | null>(null);
  const [focusId, setFocusId] = useState(initialSkill);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [lesson, setLesson] = useState<TeacherLesson | null>(null);
  const [prep, setPrep] = useState<TeacherPrepState | null>(null);
  const [prepMessage, setPrepMessage] = useState("");
  const [cfuGuide, setCfuGuide] = useState<CfuGuide | null>(null);
  const [diffPlan, setDiffPlan] = useState<DiffPlan | null>(null);
  const [pickedStandard, setPickedStandard] = useState<{
    code: string;
    description: string;
    grade: string;
  } | null>(null);

  const focus = useMemo(
    () => session?.skills.find((s) => s.componentId === focusId) ?? session?.skills[0] ?? null,
    [session, focusId],
  );

  const loadSession = useCallback(async (raw: string) => {
    setLoading(true);
    setError(null);
    setLesson(null);
    setPrep(null);
    setCfuGuide(null);
    setDiffPlan(null);
    try {
      const res = await fetch(
        `/api/teacher/session?sessionId=${encodeURIComponent(raw.trim())}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, "Session not found"));
      setSession(json as SessionView);
      setCodeInput(json.shortCode || raw);
      const preferred =
        initialSkill &&
        (json.skills as SkillRow[]).some((s) => s.componentId === initialSkill)
          ? initialSkill
          : json.skills[0]?.componentId || "";
      setFocusId(preferred);
    } catch (err) {
      setSession(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [initialSkill]);

  async function buildLesson() {
    if (!session || !focus) return;
    setActionLoading("lesson");
    setError(null);
    try {
      const res = await apiFetch("/api/teacher/lesson/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          componentId: focus.componentId,
          statementCode: pickedStandard?.code,
          refresh: Boolean(pickedStandard?.code),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, "Lesson failed"));
      setLesson(json.lesson);
      await loadSession(session.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }

  async function startPrep() {
    if (!session || !focus) return;
    setActionLoading("prep");
    setError(null);
    try {
      if (!lesson) {
        const lr = await apiFetch("/api/teacher/lesson/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: session.sessionId,
            componentId: focus.componentId,
          }),
        });
        const lj = await lr.json();
        if (!lr.ok) throw new Error(apiErrorMessage(lj, "Need lesson first"));
        setLesson(lj.lesson);
      }
      const res = await apiFetch("/api/teacher/prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          componentId: focus.componentId,
          action: "start",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, "Prep failed"));
      setPrep(json.prep);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }

  async function sendPrepTurn() {
    if (!session || !focus || !prepMessage.trim()) return;
    setActionLoading("prep-turn");
    setError(null);
    try {
      const res = await apiFetch("/api/teacher/prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          componentId: focus.componentId,
          action: "turn",
          message: prepMessage.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, "Prep turn failed"));
      setPrep(json.prep);
      setPrepMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }

  async function finalizePrep() {
    if (!session || !focus) return;
    setActionLoading("prep-final");
    try {
      const res = await apiFetch("/api/teacher/prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          componentId: focus.componentId,
          action: "finalize",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, "Finalize failed"));
      setPrep(json.prep);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }

  async function loadCfuGuide(generateIfMissing: boolean) {
    if (!session || !focus) return;
    setActionLoading("cfu");
    setError(null);
    try {
      const q = new URLSearchParams({
        sessionId: session.sessionId,
        componentId: focus.componentId,
      });
      if (generateIfMissing) q.set("generate", "1");
      const res = await apiFetch(`/api/teacher/cfu-guide?${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, "CFU guide failed"));
      setCfuGuide(json.guide);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }

  async function loadDiff() {
    if (!session || !focus) return;
    setActionLoading("diff");
    setError(null);
    try {
      const q = new URLSearchParams({
        sessionId: session.sessionId,
        componentId: focus.componentId,
      });
      const res = await fetch(`/api/teacher/diff-plan?${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, "Diff plan failed"));
      setDiffPlan(json.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }

  function downloadLessonMd() {
    if (!session || !focus) return;
    window.open(
      `/api/teacher/lesson/download?sessionId=${encodeURIComponent(session.sessionId)}&componentId=${encodeURIComponent(focus.componentId)}`,
      "_blank",
    );
  }

  function downloadPrepMd() {
    if (!prep?.prepNoteMarkdown) return;
    const blob = new Blob([prep.prepNoteMarkdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prep-note.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 px-6 py-10">
      <ApiKeyPanel compact />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
            Teacher console
          </p>
          <h1 className="text-3xl font-semibold text-zinc-900">
            Plan from student diagnostic
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Paste a student session code or open their teacher link. Skills:
            lesson plan creation + lesson prep; CFU & differentiation guides
            reuse student artifacts.
          </p>
        </div>
        <Link
          href="/"
          className="text-sm font-medium text-indigo-600 hover:underline"
        >
          ← Student app
        </Link>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <label className="text-sm font-medium text-zinc-800">
          Session code or full session id
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="e.g. A1B2C3D4"
            className="min-w-[220px] flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={loading || !codeInput.trim()}
            onClick={() => loadSession(codeInput)}
            className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Open session"}
          </button>
          {initialSession && !session && (
            <button
              type="button"
              disabled={loading}
              onClick={() => loadSession(initialSession)}
              className="rounded-xl border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-900 disabled:opacity-50"
            >
              Open linked session
            </button>
          )}
        </div>
        {initialAction && (
          <p className="mt-2 text-xs text-zinc-500">
            Link action: <strong>{initialAction}</strong>
            {initialSkill ? ` · skill ${initialSkill.slice(0, 8)}…` : ""} — open
            session, then use the matching Teacher action button.
          </p>
        )}
      </section>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {session && (
        <LcMasterySection
          key={session.sessionId}
          request={{ sessionId: session.sessionId }}
          title="Mastery heatmap (standard → learning component)"
        />
      )}

      {session && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr_1fr]">
          {/* Snapshot */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Student snapshot</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Grade {session.grade} · {session.result.score}/
              {session.result.total} ({session.result.percent}%) · code{" "}
              <span className="font-mono font-semibold">{session.shortCode}</span>
            </p>
            {session.roadmapSummary && (
              <p className="mt-3 text-sm leading-relaxed text-zinc-700">
                {session.roadmapSummary}
              </p>
            )}
            <ul className="mt-4 space-y-2">
              {session.result.byComponent.map((c) => (
                <li
                  key={c.componentId}
                  className="rounded-lg border border-zinc-100 px-3 py-2 text-xs"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-zinc-800">
                      {c.description}
                    </span>
                    <span
                      className={
                        c.mastered ? "text-emerald-700" : "text-amber-800"
                      }
                    >
                      {c.correct}/{c.total}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Focus */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Focus skill</h2>
            <div className="mt-3 space-y-2">
              {session.skills.map((s) => (
                <button
                  key={s.componentId}
                  type="button"
                  onClick={() => {
                    setFocusId(s.componentId);
                    setLesson(null);
                    setPrep(null);
                    setCfuGuide(null);
                    setDiffPlan(null);
                  }}
                  className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${
                    focus?.componentId === s.componentId
                      ? "border-violet-600 bg-violet-50"
                      : "border-zinc-200 hover:border-violet-300"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase text-violet-700">
                      Step {s.order} · {s.priority}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {[
                        s.artifacts.cfu && "CFU",
                        s.artifacts.studySheet && "Sheet",
                        s.artifacts.differentiation && "A/B/C",
                        s.artifacts.teacherLesson && "Lesson",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "no artifacts yet"}
                    </span>
                  </div>
                  <p className="mt-1 font-medium text-zinc-900">{s.skill}</p>
                </button>
              ))}
              {session.skills.length === 0 && (
                <p className="text-sm text-zinc-500">
                  No roadmap priorities on this session.
                </p>
              )}
            </div>
            {focus && (
              <div className="mt-4 space-y-2 text-sm text-zinc-700">
                <p>
                  <span className="font-semibold">Why now: </span>
                  {focus.whyNow}
                </p>
                <p>
                  <span className="font-semibold">Mastery: </span>
                  {focus.masteryLooksLike}
                </p>
                {focus.standardCodes?.length > 0 && (
                  <p className="text-xs text-zinc-500">
                    From student plan: {focus.standardCodes.slice(0, 3).join(", ")}
                  </p>
                )}
              </div>
            )}
            {session && (
              <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase text-violet-800">
                  Align to a standard (category pick)
                </p>
                <StandardCategoryPicker
                  initialGrade={session.grade}
                  onSelect={(sel) =>
                    setPickedStandard({
                      code: sel.code,
                      description: sel.description,
                      grade: sel.grade,
                    })
                  }
                />
                {pickedStandard && (
                  <p className="mt-2 text-xs text-violet-950">
                    Lesson will reference{" "}
                    <span className="font-mono font-semibold">
                      {pickedStandard.code}
                    </span>
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Actions */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Teacher actions</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Selected: {focus?.skill ?? "—"}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={!focus || !!actionLoading}
                onClick={() => buildLesson()}
                className="rounded-xl bg-violet-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {actionLoading === "lesson"
                  ? "Building lesson…"
                  : "Build lesson for this skill"}
              </button>
              <button
                type="button"
                disabled={!focus || !!actionLoading}
                onClick={() => startPrep()}
                className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-900 disabled:opacity-50"
              >
                {actionLoading === "prep" ? "Starting prep…" : "Prep to teach"}
              </button>
              <button
                type="button"
                disabled={!focus || !!actionLoading}
                onClick={() => loadCfuGuide(true)}
                className="rounded-xl border border-teal-300 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-900 disabled:opacity-50"
              >
                {actionLoading === "cfu"
                  ? "Loading CFU guide…"
                  : "Open CFU teacher guide"}
              </button>
              <button
                type="button"
                disabled={!focus || !!actionLoading}
                onClick={() => loadDiff()}
                className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-800 disabled:opacity-50"
              >
                {actionLoading === "diff"
                  ? "Loading diff plan…"
                  : "Open differentiation plan"}
              </button>
              {session && focus && (
                <Link
                  href={`/lab?session=${encodeURIComponent(session.sessionId)}&componentId=${encodeURIComponent(focus.componentId)}&source=lesson`}
                  className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-center text-sm font-semibold text-amber-950"
                >
                  Open in Quality Lab →
                </Link>
              )}
            </div>
            <p className="mt-3 text-[11px] text-zinc-500">
              Differentiation requires the student (or you via student UI) to
              generate Leveled practice first. Quality Lab is a separate Giáo
              vụ module for evaluators — not stacked here.
            </p>
          </section>
        </div>
      )}

      {lesson && (
        <section className="rounded-2xl border border-violet-200 bg-violet-50/30 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-zinc-900">{lesson.title}</h2>
            <button
              type="button"
              onClick={downloadLessonMd}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white"
            >
              Download .md
            </button>
          </div>
          <p className="mt-2 text-sm text-zinc-700">{lesson.standardGist}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold">Learning goal</h3>
              <p className="mt-1 text-sm text-zinc-800">{lesson.learningGoal}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Launch</h3>
              <p className="mt-1 text-sm text-zinc-800">{lesson.launch}</p>
            </div>
            <div className="md:col-span-2">
              <h3 className="text-sm font-semibold">Explore — key task</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">
                {lesson.exploreKeyTask}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Discuss</h3>
              <p className="mt-1 text-sm text-zinc-800">{lesson.discuss}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Exit</h3>
              <p className="mt-1 text-sm text-zinc-800">{lesson.exit}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Look-fors</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-zinc-800">
                {lesson.observationLookFors.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Materials</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-zinc-800">
                {lesson.materials.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {prep && (
        <section className="rounded-2xl border border-indigo-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Prep to teach</h2>
            {prep.prepNoteMarkdown && (
              <button
                type="button"
                onClick={downloadPrepMd}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold"
              >
                Download prep note .md
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500">{prep.lessonTitle}</p>
          <div className="mt-4 max-h-80 space-y-3 overflow-y-auto rounded-xl border border-zinc-100 bg-zinc-50 p-4">
            {prep.turns.map((t, i) => (
              <div
                key={`${t.role}-${i}`}
                className={`rounded-lg px-3 py-2 text-sm ${
                  t.role === "coach"
                    ? "bg-white text-zinc-800"
                    : "bg-indigo-100 text-indigo-950"
                }`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                  {t.role === "coach" ? "Prep partner" : "You"}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{t.text}</p>
              </div>
            ))}
          </div>
          {prep.status === "active" && (
            <div className="mt-4 flex flex-wrap gap-2">
              <input
                value={prepMessage}
                onChange={(e) => setPrepMessage(e.target.value)}
                placeholder="Your reply (or type finalize)"
                className="min-w-[240px] flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={!!actionLoading || !prepMessage.trim()}
                onClick={() => sendPrepTurn()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Send
              </button>
              <button
                type="button"
                disabled={!!actionLoading}
                onClick={() => finalizePrep()}
                className="rounded-xl border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-900"
              >
                Finalize prep note
              </button>
            </div>
          )}
          {prep.prepNoteMarkdown && (
            <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-800">
              {prep.prepNoteMarkdown}
            </pre>
          )}
        </section>
      )}

      {cfuGuide && (
        <section className="rounded-2xl border border-teal-200 bg-teal-50/40 p-6">
          <h2 className="text-xl font-semibold">CFU teacher guide</h2>
          <p className="mt-1 text-sm text-zinc-700">
            Focus: {cfuGuide.focus} · Rigor: {cfuGuide.rigor}
          </p>
          <div className="mt-4 space-y-4">
            {cfuGuide.items.map((item, idx) => (
              <div
                key={item.id}
                className="rounded-xl border border-teal-100 bg-white p-4 text-sm"
              >
                <p className="font-medium">
                  {idx + 1}. {item.stem}
                </p>
                <p className="mt-2 text-xs text-emerald-800">
                  Correct: {item.correct_answer}
                </p>
                <ul className="mt-3 space-y-2">
                  {item.responseRoutes.map((r) => (
                    <li
                      key={r.choice}
                      className="rounded-lg border border-zinc-100 px-3 py-2 text-xs text-zinc-700"
                    >
                      <p className="font-semibold text-zinc-900">{r.choice}</p>
                      <p className="mt-1">Reveals: {r.reveals}</p>
                      <p className="mt-1">Next step: {r.nextStep}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {diffPlan && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Differentiation plan</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Source: {diffPlan.sourceSheetTitle}
          </p>
          <p className="mt-2 text-sm text-zinc-700">
            {diffPlan.teacherPlanLite.flexibleGroupingNote}
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm text-zinc-700">
            {diffPlan.teacherPlanLite.whyThisWorks.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {diffPlan.tiers.map((t) => (
              <div
                key={t.group}
                className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm"
              >
                <p className="font-semibold">
                  {t.title}{" "}
                  <span className="text-xs font-normal text-zinc-500">
                    ({t.level})
                  </span>
                </p>
                <p className="mt-1 text-xs text-zinc-600">{t.intro}</p>
                <ol className="mt-3 list-decimal space-y-2 pl-4 text-xs">
                  {t.tasks.map((task) => (
                    <li key={task.id}>
                      {task.prompt}
                      {task.supportNote && (
                        <span className="block text-zinc-500">
                          Support: {task.supportNote}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

export default function TeacherPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-500">
          Loading teacher console…
        </main>
      }
    >
      <TeacherPageInner />
    </Suspense>
  );
}
