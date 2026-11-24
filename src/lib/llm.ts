const DEFAULT_MODEL = "gpt-4o-mini";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function getApiKey() {
  const key =
    process.env.OPENAI_API_KEY?.trim() || process.env.XAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set in .env.local");
  }
  return key;
}

function getModel() {
  return process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
}

function getBaseUrl() {
  if (process.env.LLM_BASE_URL?.trim()) {
    return process.env.LLM_BASE_URL.trim().replace(/\/$/, "");
  }
  if (process.env.OPENAI_API_KEY?.trim()) {
    return "https://api.openai.com/v1";
  }
  if (process.env.XAI_API_KEY?.trim()) {
    return "https://api.x.ai/v1";
  }
  return "https://api.openai.com/v1";
}

export function hasLlmKey() {
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() || process.env.XAI_API_KEY?.trim(),
  );
}

export async function callLlmJson<T>(params: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
}): Promise<T> {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const model =
    params.model ??
    (baseUrl.includes("x.ai") ? "grok-3" : getModel());

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
    throw new Error(`LLM API error ${res.status}: ${text.slice(0, 500)}`);
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
