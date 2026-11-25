const STORAGE_KEY = "amc_openai_api_key";

export function getStoredOpenAiKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY)?.trim() || "";
    return v || null;
  } catch {
    return null;
  }
}

export function setStoredOpenAiKey(key: string) {
  const k = key.trim();
  localStorage.setItem(STORAGE_KEY, k);
}

export function clearStoredOpenAiKey() {
  localStorage.removeItem(STORAGE_KEY);
}

export function looksLikeOpenAiKey(key: string) {
  const k = key.trim();
  return k.startsWith("sk-") && k.length >= 20;
}

/** fetch wrapper: attaches x-openai-api-key from localStorage when present */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  const key = getStoredOpenAiKey();
  if (key && looksLikeOpenAiKey(key)) {
    headers.set("x-openai-api-key", key);
  }
  return fetch(input, { ...init, headers });
}
