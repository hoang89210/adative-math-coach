import { expect, test } from "@playwright/test";
import {
  assertDbReady,
  fetchHealth,
  fillApiKeyPanel,
  finishDiagnosticAndWaitForResults,
  makeE2ELabel,
  noSecretCapture,
  readResultsShortCode,
  saveE2ESession,
  selectGrade,
  shouldRunE2E,
  startDiagnosticAndWaitForTest,
} from "./helpers";

/**
 * Diagnostic Submit → a row should be created in amc_sessions.
 * Gated: skips unless RUN_E2E=1. Calls OpenAI (key from env) and writes a session.
 *
 * Prod cap: this file performs at most ONE diagnostic Submit. Teacher reuse
 * and grade-matrix generate-only must not add more submits. Max 2 submits
 * across the whole suite (this is the primary one).
 *
 * The app has no student-name field; the run tag e2e-test-<timestamp> is
 * recorded in the local artifact and the report, not as a DB column.
 * Verify the row with a filtered SELECT on id / short_code.
 */
test.use(noSecretCapture);

test.describe("Diagnostic submit → amc_sessions", () => {
  test.skip(!shouldRunE2E(), "Skipped: set RUN_E2E=1 to run write/OpenAI E2E");

  test("Submit Grade 4 diagnostic, then session is retrievable", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    const label = makeE2ELabel();
    testInfo.annotations.push({ type: "e2e-label", description: label });
    console.log("[e2e] run label:", label);

    const health = await fetchHealth(request);
    expect(health.status).toBe(200);
    assertDbReady(health.body);

    await page.goto("/");
    await fillApiKeyPanel(page);
    await selectGrade(page, "4");
    await startDiagnosticAndWaitForTest(page, /Start Grade 4 diagnostic/);
    await expect(page.getByRole("heading", { name: /Question 1 of \d+/ })).toBeVisible({
      timeout: 30_000,
    });

    await finishDiagnosticAndWaitForResults(page);

    const codeText = await readResultsShortCode(page);
    const scoreHeading = page.getByRole("heading", { name: /You scored / });
    const headingText = (await scoreHeading.innerText()).trim();
    const scoreMatch = headingText.match(/You scored (\d+)\/(\d+) \((\d+)%\)/);

    // Black-box verification (no direct DB): teacher session API is the
    // public read path that loads from amc_sessions when sessionStore=supabase.
    const api = await request.get(
      `/api/teacher/session?sessionId=${encodeURIComponent(codeText)}`,
    );
    expect(
      api.status(),
      "GET /api/teacher/session should 200 if the row was saved",
    ).toBe(200);
    const json = (await api.json()) as {
      sessionId?: string;
      shortCode?: string;
      grade?: string;
      result?: { score?: number; total?: number; percent?: number };
    };
    expect(json.shortCode).toBe(codeText);
    expect(json.grade).toBe("4");
    expect(json.sessionId).toBeTruthy();

    const record = {
      label,
      sessionId: String(json.sessionId),
      shortCode: codeText,
      grade: "4",
      score: json.result?.score ?? (scoreMatch ? Number(scoreMatch[1]) : undefined),
      total: json.result?.total ?? (scoreMatch ? Number(scoreMatch[2]) : undefined),
      percent: json.result?.percent ?? (scoreMatch ? Number(scoreMatch[3]) : undefined),
      createdAt: new Date().toISOString(),
    };
    saveE2ESession(record);
    console.log("[e2e] saved session artifact:", JSON.stringify(record));

    // Gold-standard DB check (filtered SELECT, run after this test):
    //   select id, short_code, grade, jurisdiction, percent, score, total, created_at
    //   from amc_sessions
    //   where short_code = '<code>' or id = '<sessionId>'::uuid;
  });
});
