import { expect, test } from "@playwright/test";
import {
  answerCurrentQuestionAndAdvance,
  assertDbReady,
  fetchHealth,
  fillApiKeyPanel,
  selectGrade,
  shouldRunE2E,
} from "./helpers";

/**
 * Diagnostic Submit → a row should be created in amc_sessions.
 * Gated: skips unless RUN_E2E=1. Calls OpenAI (key from env) and writes a session.
 * Do not run against prod until health dbOk is true and Hoàng approves test data.
 */
test.describe("Diagnostic submit → amc_sessions", () => {
  test.skip(!shouldRunE2E(), "Skipped: set RUN_E2E=1 to run write/OpenAI E2E");

  test("Submit Grade 4 diagnostic, then session is retrievable", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);

    const health = await fetchHealth(request);
    expect(health.status).toBe(200);
    assertDbReady(health.body);

    await page.goto("/");
    await fillApiKeyPanel(page);
    await selectGrade(page, "4");
    await page.getByRole("button", { name: /Start Grade 4 diagnostic/ }).click();

    await expect(page).toHaveURL(/\/test/);
    await expect(page.getByText(/Question 1 of \d+/)).toBeVisible({
      timeout: 90_000,
    });

    // Up to 8 questions; last click is Submit.
    for (let i = 0; i < 8; i++) {
      if (await page.getByRole("heading", { name: /You scored / }).count()) {
        break;
      }
      await expect(page.getByText(/Question \d+ of \d+/)).toBeVisible();
      await answerCurrentQuestionAndAdvance(page);
    }

    await expect(page).toHaveURL(/\/results/, { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: /You scored / })).toBeVisible();

    const codeLabel = page.locator("span", { hasText: /^Code [A-Z0-9]{8}$/ });
    await expect(codeLabel).toBeVisible();
    const codeText = (await codeLabel.innerText()).replace(/^Code\s+/, "").trim();
    expect(codeText).toMatch(/^[A-Z0-9]{8}$/);

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
    };
    expect(json.shortCode).toBe(codeText);
    expect(json.grade).toBe("4");
    expect(json.sessionId).toBeTruthy();

    // Gold-standard DB check is manual (see TEST_PLAN.md):
    //   select id, short_code, grade, created_at from amc_sessions
    //   where short_code = '<code>' or id = '<sessionId>';
    // Requires Supabase SQL access (project supabase-erin-forest) or DATABASE_URL.
    // There is no public health/admin endpoint that lists amc_sessions rows.
  });
});
