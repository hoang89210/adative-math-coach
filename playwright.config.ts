import { defineConfig, devices } from "@playwright/test";

/**
 * baseURL comes from BASE_URL, defaulting to production.
 * Do not put secrets in this file. OPENAI_API_KEY is read at runtime
 * by gated specs only and must never be logged, printed, or committed.
 */
const baseURL =
  process.env.BASE_URL?.trim() || "https://adative-math-coach.vercel.app";

const runE2E = process.env.RUN_E2E === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: !runE2E,
  forbidOnly: !!process.env.CI,
  // Never retry write/OpenAI runs — a retry would burn the prod submit cap.
  retries: runE2E ? 0 : process.env.CI ? 2 : 0,
  workers: runE2E ? 1 : process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    // Traces/screenshots/videos can capture a pasted API key. Always off
    // during RUN_E2E=1; otherwise screenshots only on failure (smoke).
    trace: "off",
    screenshot: runE2E ? "off" : "only-on-failure",
    video: "off",
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
