const STORAGE_KEY = "amc_openai_api_key";
const SERVER_MODE_KEY = "amc_use_server_test_key";

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

export function isUsingServerTestKey(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SERVER_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setUsingServerTestKey(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) localStorage.setItem(SERVER_MODE_KEY, "1");
  else localStorage.removeItem(SERVER_MODE_KEY);
}

/**
 * fetch wrapper: attaches x-openai-api-key from localStorage, or
 * x-use-server-key when the user chose server test-key mode.
 * The server key itself is never sent to or stored on the client.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  if (isUsingServerTestKey()) {
    headers.set("x-use-server-key", "1");
    headers.delete("x-openai-api-key");
  } else {
    const key = getStoredOpenAiKey();
    if (key && looksLikeOpenAiKey(key)) {
      headers.set("x-openai-api-key", key);
    }
  }
  return fetch(input, { ...init, headers });
}

export const OPENAI_KEY_REQUIRED = "OPENAI_KEY_REQUIRED";

/** Turn an API JSON body into a user-facing error, with a key-panel hint when needed. */
export function apiErrorMessage(data: unknown, fallback: string): string {
  const body =
    data && typeof data === "object"
      ? (data as {
          error?: unknown;
          code?: unknown;
          serverTestKeyEnabled?: unknown;
        })
      : {};
  if (body.code === OPENAI_KEY_REQUIRED) {
    if (body.serverTestKeyEnabled) {
      return "OpenAI API key required. Paste your key in the yellow panel, or click “Không có key” to use the server test key.";
    }
    return (
      (typeof body.error === "string" && body.error) ||
      "OpenAI API key required. Paste your key in the yellow panel."
    );
  }
  return (typeof body.error === "string" && body.error) || fallback;
}
