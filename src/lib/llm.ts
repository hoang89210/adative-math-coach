import { AsyncLocalStorage } from "node:async_hooks";
import { NextResponse } from "next/server";
import { redactSecretString } from "./log-safe";
import {
  isServerTestKeyEnabled,
  parseAllowServerKeyFallbackFlag,
  parseAllowServerTestKeyFlag,
  resolveLlmRequestAccess,
  selectLlmApiKey,
} from "./server-test-key";

const DEFAULT_MODEL = "gpt-4o-mini";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type LlmContext = { apiKey?: string; useServerKey?: boolean };

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

/**
 * Run LLM calls with the key the server selects:
 * - header x-use-server-key + ALLOW_SERVER_TEST_KEY: use env OPENAI_API_KEY
 *   (always rate-limited)
 * - otherwise: the user's x-openai-api-key, if present
 * - optional ALLOW_SERVER_KEY_FALLBACK=1 (off by default): same server key,
 *   also rate-limited, only when the client sent no personal key
 * A request with no personal key and no authorized server-key path returns
 * 401 OPENAI_KEY_REQUIRED — the env key is never used as a silent default.
 */
export function withLlmRequestKey<T>(
  request: Request,
  fn: () => Promise<T>,
): Promise<T> {
  const access = resolveLlmRequestAccess(request, getRequestApiKey(request));
  if (!access.ok) {
    const headers: Record<string, string> = {};
    if (access.retryAfter) {
      headers["Retry-After"] = String(access.retryAfter);
    }
    return Promise.resolve(
      NextResponse.json(
        {
          error: access.error,
          ...(access.code ? { code: access.code } : {}),
          ...(access.serverTestKeyEnabled !== undefined
            ? { serverTestKeyEnabled: access.serverTestKeyEnabled }
            : {}),
        },
        { status: access.status, headers },
      ) as T,
    );
  }
  if (access.useServerKey) {
    return llmContext.run({ useServerKey: true }, fn);
  }
  return llmContext.run({ apiKey: access.apiKey }, fn);
}

function resolveApiKey(explicit?: string) {
  const ctx = llmContext.getStore();
  const selected = selectLlmApiKey({
    useServerKey: Boolean(ctx?.useServerKey),
    allowServerTestKey: parseAllowServerTestKeyFlag(),
    allowServerKeyFallback: parseAllowServerKeyFallbackFlag(),
    serverKey: process.env.OPENAI_API_KEY,
    userKey: explicit?.trim() || ctx?.apiKey,
    serverTestKeyEnabled: isServerTestKeyEnabled(),
  });
  if (!selected.ok) {
    throw new Error(selected.error);
  }
  return selected.key;
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
  const ctx = llmContext.getStore();
  // Env OPENAI_API_KEY alone is not enough: the request must have been
  // authorized to use the server key (button header or fallback flag + limiter).
  if (ctx?.useServerKey) {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }
  return Boolean(explicit?.trim() || ctx?.apiKey?.trim());
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
