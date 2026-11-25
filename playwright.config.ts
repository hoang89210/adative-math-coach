import { defineConfig, devices } from "@playwright/test";

/**
 * baseURL comes from BASE_URL, defaulting to production.
 * Do not put secrets in this file. OPENAI_API_KEY is read at runtime
 * by gated specs only and must never be logged, printed, or committed.
 */
const baseURL =
  process.env.BASE_URL?.trim() || "https://adative-math-coach.vercel.app";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    // Traces/screenshots can capture a pasted API key. Keep off unless debugging
    // a non-key failure; never share traces from RUN_E2E keyed runs.
    trace: "off",
    screenshot: "only-on-failure",
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
