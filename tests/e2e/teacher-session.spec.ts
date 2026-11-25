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
 * Teacher session-code flow. The happy path needs a real saved session,
 * so it is gated with RUN_E2E=1 (creates a diagnostic first).
 * The unknown-code case lives in smoke.spec.ts (read-only).
 */
test.describe("Teacher session code flow", () => {
  test.skip(!shouldRunE2E(), "Skipped: set RUN_E2E=1 to run write/OpenAI E2E");

  test("Results code opens Teacher snapshot", async ({ page, request }) => {
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
    for (let i = 0; i < 8; i++) {
      if (await page.getByRole("heading", { name: /You scored / }).count()) break;
      await expect(page.getByText(/Question \d+ of \d+/)).toBeVisible();
      await answerCurrentQuestionAndAdvance(page);
    }
    await expect(page).toHaveURL(/\/results/, { timeout: 90_000 });

    const codeLabel = page.locator("span", { hasText: /^Code [A-Z0-9]{8}$/ });
    await expect(codeLabel).toBeVisible();
    const codeText = (await codeLabel.innerText()).replace(/^Code\s+/, "").trim();

    await page.getByRole("link", { name: "Teacher view" }).click();
    await expect(page).toHaveURL(/\/teacher/);
    // Linked session may need a click if auto-load is not wired on first paint.
    const openLinked = page.getByRole("button", { name: "Open linked session" });
    const openSession = page.getByRole("button", { name: "Open session" });
    if (await openLinked.isVisible().catch(() => false)) {
      await openLinked.click();
    } else if (await page.getByPlaceholder("e.g. A1B2C3D4").inputValue()) {
      await openSession.click();
    }

    await expect(page.getByRole("heading", { name: "Student snapshot" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("span.font-mono", { hasText: codeText })).toBeVisible();
    await expect(page.getByText(/Grade 4/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Focus skill" })).toBeVisible();
  });
});
