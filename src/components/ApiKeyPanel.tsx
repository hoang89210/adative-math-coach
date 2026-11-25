"use client";

import { useEffect, useState } from "react";
import {
  clearStoredOpenAiKey,
  getStoredOpenAiKey,
  isUsingServerTestKey,
  looksLikeOpenAiKey,
  setStoredOpenAiKey,
  setUsingServerTestKey,
} from "@/lib/client-api-key";

type Props = {
  className?: string;
  compact?: boolean;
};

export function ApiKeyPanel({ className = "", compact = false }: Props) {
  const [value, setValue] = useState(() => getStoredOpenAiKey() || "");
  const [saved, setSaved] = useState(() => Boolean(getStoredOpenAiKey()));
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [serverMode, setServerMode] = useState(() => isUsingServerTestKey());
  const [serverKeyAvailable, setServerKeyAvailable] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data: { serverTestKeyEnabled?: boolean }) => {
        setServerKeyAvailable(Boolean(data.serverTestKeyEnabled));
        if (!data.serverTestKeyEnabled && isUsingServerTestKey()) {
          setUsingServerTestKey(false);
          setServerMode(false);
        }
      })
      .catch(() => setServerKeyAvailable(false));
  }, []);

  function useServerKey() {
    setUsingServerTestKey(true);
    setServerMode(true);
    setMsg("Using the server test key for this browser. Switch back anytime.");
  }

  function useOwnKey() {
    setUsingServerTestKey(false);
    setServerMode(false);
    setMsg("Switched back to your own key (if saved on this device).");
  }

  function save() {
    const k = value.trim();
    if (!looksLikeOpenAiKey(k)) {
      setMsg("Key should start with sk- and be long enough.");
      return;
    }
    setStoredOpenAiKey(k);
    setSaved(true);
    setUsingServerTestKey(false);
    setServerMode(false);
    setMsg("Saved on this device only. Not uploaded to our database.");
  }

  function clear() {
    clearStoredOpenAiKey();
    setValue("");
    setSaved(false);
    setMsg("Key cleared from this browser.");
  }

  const serverToggle = serverKeyAvailable ? (
    serverMode ? (
      <button
        type="button"
        onClick={useOwnKey}
        className={
          compact
            ? "rounded-lg border border-teal-300 bg-white px-2 py-1 font-semibold text-teal-950"
            : "rounded-xl border border-teal-300 bg-white px-4 py-2 text-xs font-semibold text-teal-950"
        }
      >
        Dùng key của tôi
      </button>
    ) : (
      <button
        type="button"
        onClick={useServerKey}
        className={
          compact
            ? "rounded-lg border border-teal-600 bg-teal-700 px-2 py-1 font-semibold text-white"
            : "rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white"
        }
      >
        Không có key
      </button>
    )
  ) : null;

  const serverLabel = serverMode ? (
    <p
      className={
        compact
          ? "text-[11px] font-medium text-teal-800"
          : "mt-2 text-xs font-medium text-teal-800"
      }
    >
      đang dùng key test của server
    </p>
  ) : null;

  if (compact) {
    return (
      <div
        className={`flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs ${className}`}
      >
        <span className="font-semibold text-amber-950">
          {serverMode
            ? "Using server test key"
            : saved
              ? "OpenAI key on device"
              : "No OpenAI key on device"}
        </span>
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-..."
          className="min-w-[160px] flex-1 rounded-lg border border-amber-200 bg-white px-2 py-1 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="text-amber-900 underline"
        >
          {show ? "Hide" : "Show"}
        </button>
        <button
          type="button"
          onClick={save}
          className="rounded-lg bg-amber-800 px-2 py-1 font-semibold text-white"
        >
          Save
        </button>
        <button
          type="button"
          onClick={clear}
          className="rounded-lg border border-amber-300 px-2 py-1 font-semibold text-amber-950"
        >
          Clear
        </button>
        {serverToggle}
        {serverLabel}
      </div>
    );
  }

  return (
    <section
      className={`rounded-2xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm ${className}`}
    >
      <h2 className="text-sm font-semibold text-amber-950">
        Your OpenAI API key (optional)
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
        Paste a key from{" "}
        <a
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noreferrer"
          className="font-medium underline"
        >
          platform.openai.com/api-keys
        </a>
        . It stays in <strong>this browser only</strong> and is sent only to our
        app so we can call OpenAI for you. We do not store it in our database.
        Clear it anytime. If empty, the app uses the server key when configured.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-proj-... or sk-..."
          className="min-w-[220px] flex-1 rounded-xl border border-amber-200 bg-white px-3 py-2 font-mono text-sm"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="rounded-xl border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-950"
        >
          {show ? "Hide" : "Show"}
        </button>
        <button
          type="button"
          onClick={save}
          className="rounded-xl bg-amber-800 px-4 py-2 text-xs font-semibold text-white"
        >
          Save key
        </button>
        <button
          type="button"
          onClick={clear}
          className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800"
        >
          Clear
        </button>
        {serverToggle}
      </div>
      {serverLabel}
      <p className="mt-2 text-xs text-amber-950">
        Status:{" "}
        <strong>
          {serverMode
            ? "đang dùng key test của server"
            : saved
              ? "Key saved on this device"
              : "No key on this device"}
        </strong>
      </p>
      {msg && <p className="mt-1 text-xs text-zinc-600">{msg}</p>}
    </section>
  );
}
