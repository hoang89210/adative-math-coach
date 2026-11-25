import { defineConfig, devices } from "@playwright/test";

/**
 * Safety defaults:
 * - Without BASE_URL, Playwright starts a local Next.js server on
 *   http://127.0.0.1:3100 with no DATABASE_URL (local-fs) and no real OpenAI key.
 * - Running against any non-local BASE_URL (prod or preview) requires BOTH
 *   BASE_URL=... and E2E_ALLOW_REMOTE=1, otherwise config throws immediately.
 * - Write/real-OpenAI specs stay gated behind RUN_E2E=1.
 */
const DEFAULT_LOCAL_PORT = 3100;
const DEFAULT_LOCAL_URL = `http://127.0.0.1:${DEFAULT_LOCAL_PORT}`;
const rawBaseUrl = process.env.BASE_URL?.trim() || "";

function isLocalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

if (rawBaseUrl && !isLocalUrl(rawBaseUrl) && process.env.E2E_ALLOW_REMOTE !== "1") {
  throw new Error(
    `Refusing to run E2E against remote BASE_URL (${rawBaseUrl}) without E2E_ALLOW_REMOTE=1. ` +
      `Default E2E targets a local server with local-fs storage and no real OpenAI calls.`,
  );
}

const baseURL = rawBaseUrl || DEFAULT_LOCAL_URL;
const runE2E = process.env.RUN_E2E === "1";
const useExternalServer = Boolean(rawBaseUrl);
const useEnvDb = process.env.E2E_USE_ENV_DB === "1";

if (runE2E) {
  process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
}

function buildLocalServerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  if (!useEnvDb) {
    // Isolate from any DB / Blob env vars so local-fs is used by default.
    env.DATABASE_URL = "";
    env.POSTGRES_URL = "";
    env.POSTGRES_PRISMA_URL = "";
    env.POSTGRES_URL_NON_POOLING = "";
    env.BLOB_READ_WRITE_TOKEN = "";
  }
  if (!runE2E) {
    // Never expose real LLM keys or call api.openai.com in default E2E runs.
    env.OPENAI_API_KEY = "";
    env.XAI_API_KEY = "";
    env.ALLOW_SERVER_TEST_KEY = "";
    env.ALLOW_SERVER_KEY_FALLBACK = "";
    env.LLM_BASE_URL = "http://127.0.0.1:1/v1";
  }
  return env;
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: !runE2E,
  forbidOnly: !!process.env.CI,
  // Never retry write/OpenAI runs — a retry could repeat mutations.
  retries: runE2E ? 0 : process.env.CI ? 2 : 0,
  workers: runE2E ? 1 : process.env.CI ? 2 : undefined,
  // HTML reporter is disabled for RUN_E2E so a failure snapshot cannot archive an API key.
  reporter: runE2E ? [["list"]] : [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    // Traces/screenshots/videos can capture a pasted API key. Keep off during RUN_E2E=1.
    trace: "off",
    screenshot: runE2E ? "off" : "only-on-failure",
    video: "off",
    ignoreHTTPSErrors: false,
  },
  ...(useExternalServer
    ? {}
    : {
        webServer: {
          command: `npm run build && npx next start -H 127.0.0.1 -p ${DEFAULT_LOCAL_PORT}`,
          url: `${DEFAULT_LOCAL_URL}/api/health`,
          reuseExistingServer: false,
          timeout: 180_000,
          env: buildLocalServerEnv(),
        },
      }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
