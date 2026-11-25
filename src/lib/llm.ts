import { redactSecretString } from "./log-safe";
import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_MODEL = "gpt-4o-mini";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type LlmContext = { apiKey?: string };

const llmContext = new AsyncLocalStorage<LlmContext>();

/**
 * Read the optional per-request user key from `x-openai-api-key`.
 * Never log this header, the raw Request/Headers object, or the returned value.
 * If you must log request headers, pass them through `redactHeaders` in `@/lib/log-safe`.
 */
export function getRequestApiKey(request: Request): string | undefined {
  const raw =
    request.headers.get("x-openai-api-key")?.trim() ||
    request.headers.get("X-OpenAI-Api-Key")?.trim() ||
    "";
  if (!raw) return undefined;
  if (!raw.startsWith("sk-") || raw.length < 20) return undefined;
  return raw;
}

/** Run LLM calls with optional per-request user key (from browser). */
export function withLlmRequestKey<T>(
  request: Request,
  fn: () => Promise<T>,
): Promise<T> {
  const apiKey = getRequestApiKey(request);
  return llmContext.run({ apiKey }, fn);
}

function resolveApiKey(explicit?: string) {
  const fromCtx = llmContext.getStore()?.apiKey?.trim();
  const fromExplicit = explicit?.trim();
  const fromEnv =
    process.env.OPENAI_API_KEY?.trim() || process.env.XAI_API_KEY?.trim();
  const key = fromExplicit || fromCtx || fromEnv;
  if (!key) {
    throw new Error(
      "No OpenAI API key. Paste your key on the home page, or set OPENAI_API_KEY on the server.",
    );
  }
  return key;
}

function getModel() {
  return process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
}

function getBaseUrl(apiKey: string) {
  if (process.env.LLM_BASE_URL?.trim()) {
    return process.env.LLM_BASE_URL.trim().replace(/\/$/, "");
  }
  // User-provided sk- keys always go to OpenAI
  if (apiKey.startsWith("sk-") && !apiKey.startsWith("sk-or-")) {
    if (process.env.XAI_API_KEY?.trim() && apiKey === process.env.XAI_API_KEY.trim()) {
      return "https://api.x.ai/v1";
    }
    return "https://api.openai.com/v1";
  }
  if (process.env.XAI_API_KEY?.trim() && !process.env.OPENAI_API_KEY?.trim()) {
    return "https://api.x.ai/v1";
  }
  return "https://api.openai.com/v1";
}

export function hasLlmKey(explicit?: string) {
  const fromCtx = llmContext.getStore()?.apiKey?.trim();
  return Boolean(
    explicit?.trim() ||
      fromCtx ||
      process.env.OPENAI_API_KEY?.trim() ||
      process.env.XAI_API_KEY?.trim(),
  );
}

export function hasServerOpenAiKey() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function callLlmJson<T>(params: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  apiKey?: string;
}): Promise<T> {
  const apiKey = resolveApiKey(params.apiKey);
  const baseUrl = getBaseUrl(apiKey);
  const model =
    params.model ?? (baseUrl.includes("x.ai") ? "grok-3" : getModel());

  const body = {
    model,
    temperature: params.temperature ?? 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ] satisfies LlmMessage[],
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    // Redact at the source: OpenAI error bodies often include a masked key
    // like "sk-TESTL****...A111". Never put a raw key fragment in Error.message.
    const safeBody = redactSecretString(text.slice(0, 500));
    throw new Error(`LLM API error ${res.status}: ${safeBody}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM API returned empty content");
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("LLM response is not valid JSON");
    return JSON.parse(match[0]) as T;
  }
}

/** @deprecated use callLlmJson */
export const callGrokJson = callLlmJson;
