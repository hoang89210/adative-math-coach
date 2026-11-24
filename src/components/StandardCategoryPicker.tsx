"use client";

import { useState } from "react";

type Domain = { id: string; label: string; count: number };
type Standard = {
  code: string;
  description: string;
  standardId: string;
  componentCount: number;
};

const GRADES = [
  "K",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
];

export type StandardSelection = {
  grade: string;
  domainId: string | null;
  code: string;
  description: string;
};

type Props = {
  initialGrade?: string;
  onSelect: (sel: StandardSelection) => void;
  className?: string;
};

export function StandardCategoryPicker({
  initialGrade = "4",
  onSelect,
  className = "",
}: Props) {
  const [grade, setGrade] = useState(initialGrade);
  const [domainId, setDomainId] = useState("");
  const [domains, setDomains] = useState<Domain[]>([]);
  const [standards, setStandards] = useState<Standard[]>([]);
  const [code, setCode] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);

  async function loadDomains(nextGrade: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/standards/categories?grade=${encodeURIComponent(nextGrade)}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load categories");
      const list = (json.domains ?? []) as Domain[];
      setDomains(list);
      const first = list[0]?.id ?? "";
      setDomainId(first);
      await loadStandards(nextGrade, first, "");
      setBooted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDomains([]);
      setStandards([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadStandards(
    nextGrade: string,
    nextDomain: string,
    query: string,
  ) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ grade: nextGrade, limit: "100" });
      if (nextDomain) params.set("domain", nextDomain);
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/standards/list?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load standards");
      const list = (json.standards ?? []) as Standard[];
      setStandards(list);
      if (list[0]) {
        setCode(list[0].code);
        onSelect({
          grade: nextGrade,
          domainId: nextDomain || null,
          code: list[0].code,
          description: list[0].description,
        });
      } else {
        setCode("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStandards([]);
    } finally {
      setLoading(false);
    }
  }

  function pickCode(next: string) {
    setCode(next);
    const s = standards.find((x) => x.code === next);
    onSelect({
      grade,
      domainId: domainId || null,
      code: next,
      description: s?.description ?? "",
    });
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {!booted && (
        <button
          type="button"
          onClick={() => loadDomains(grade)}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white"
        >
          Load standard categories
        </button>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label className="text-[11px] font-semibold uppercase text-zinc-500">
            Grade
          </label>
          <select
            value={grade}
            onChange={(e) => {
              const g = e.target.value;
              setGrade(g);
              setCode("");
              setQ("");
              void loadDomains(g);
            }}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm"
          >
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g === "K" ? "Kindergarten" : `Grade ${g}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase text-zinc-500">
            Category
          </label>
          <select
            value={domainId}
            onChange={(e) => {
              const d = e.target.value;
              setDomainId(d);
              setCode("");
              void loadStandards(grade, d, q);
            }}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm"
            disabled={!domains.length}
          >
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} ({d.count})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase text-zinc-500">
            Filter
          </label>
          <div className="mt-1 flex gap-1">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => loadStandards(grade, domainId, q)}
              className="rounded-lg border border-zinc-300 px-2 text-xs font-semibold"
            >
              Go
            </button>
          </div>
        </div>
      </div>

      <div>
        <label className="text-[11px] font-semibold uppercase text-zinc-500">
          Standard {loading ? "…" : `(${standards.length})`}
        </label>
        <select
          value={code}
          onChange={(e) => pickCode(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm"
          size={6}
        >
          {standards.map((s) => (
            <option key={s.code} value={s.code} title={s.description}>
              {s.code} — {s.description.slice(0, 80)}
            </option>
          ))}
        </select>
        {code && (
          <p className="mt-2 text-xs text-zinc-600">
            Selected: <span className="font-mono font-semibold">{code}</span>
          </p>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
