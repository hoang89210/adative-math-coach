"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { DiagnosticTest } from "@/lib/types/quiz";

function readTest(): DiagnosticTest | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem("diagnosticTest");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DiagnosticTest;
  } catch {
    return null;
  }
}

export default function TestPage() {
  const router = useRouter();
  const [test] = useState<DiagnosticTest | null>(() => readTest());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing] = useState(() => {
    if (typeof window === "undefined") return false;
    return readTest() === null;
  });

  if (missing) {
    router.replace("/");
  }

  const question = useMemo(
    () => (test ? test.questions[index] : null),
    [test, index],
  );

  if (!test || !question) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-500">
        Loading test…
      </main>
    );
  }

  const currentTest = test;
  const currentQuestion = question;
  const progress = Math.round(
    ((index + 1) / currentTest.questions.length) * 100,
  );

  function setAnswer(value: string) {
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: value }));
  }

  async function submitAll() {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        grade: currentTest.grade,
        questions: currentTest.questions,
        components: currentTest.components,
        answers: Object.entries(answers).map(([questionId, answer]) => ({
          questionId,
          answer,
        })),
      };
      const res = await fetch("/api/diagnostic/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Grading failed");

      const roadRes = await fetch("/api/roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: data.sessionId }),
      });
      const roadData = await roadRes.json();
      if (!roadRes.ok) throw new Error(roadData.error || "Roadmap failed");

      sessionStorage.setItem(
        "resultsPayload",
        JSON.stringify({
          sessionId: data.sessionId,
          result: data.result,
          roadmap: roadData.roadmap,
        }),
      );
      router.push("/results");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  function next() {
    if (index < currentTest.questions.length - 1) {
      setIndex((i) => i + 1);
      return;
    }
    void submitAll();
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">
            Grade {currentTest.grade} diagnostic
          </p>
          <h1 className="text-2xl font-semibold text-zinc-900">
            Question {index + 1} of {currentTest.questions.length}
          </h1>
        </div>
        <span className="text-sm font-medium text-indigo-600">{progress}%</span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-zinc-200">
        <div
          className="h-full rounded-full bg-indigo-600 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-lg leading-relaxed text-zinc-900">
          {currentQuestion.question}
        </p>

        <div className="mt-6 space-y-3">
          {currentQuestion.type === "multiple_choice" &&
          currentQuestion.options?.length ? (
            currentQuestion.options.map((opt) => {
              const selected = answers[currentQuestion.id] === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setAnswer(opt)}
                  className={`block w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                    selected
                      ? "border-indigo-600 bg-indigo-50 text-indigo-900"
                      : "border-zinc-200 hover:border-indigo-300"
                  }`}
                >
                  {opt}
                </button>
              );
            })
          ) : (
            <input
              value={answers[currentQuestion.id] ?? ""}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type your answer"
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none ring-indigo-500 focus:ring-2"
            />
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={index === 0 || submitting}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          disabled={submitting || !answers[currentQuestion.id]}
          onClick={next}
          className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting
            ? "Scoring…"
            : index === currentTest.questions.length - 1
              ? "Submit"
              : "Next"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </main>
  );
}
