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
 * Grade matrix K, 4, 8, 10 using the yellow API-key panel.
 * Key is read from env OPENAI_API_KEY only — never printed, logged, or committed.
 * Gated with RUN_E2E=1 (each row calls OpenAI and may write a session).
 */
const GRADES = ["K", "4", "8", "10"] as const;

test.describe("Grade matrix + API-key panel", () => {
  test("API-key panel rejects a short invalid key without logging it", async ({
    page,
  }) => {
    await page.goto("/");
    const input = page.getByPlaceholder(/sk-proj-\.\.\. or sk-\.\.\.|sk-\.\.\./);
    await input.fill("sk-short");
    await page.getByRole("button", { name: "Save key" }).click();
    await expect(
      page.getByText("Key should start with sk- and be long enough."),
    ).toBeVisible();
    await expect(page.getByText("No key on this device")).toBeVisible();
  });

  for (const grade of GRADES) {
    test(`Grade ${grade}: generate diagnostic via saved user key`, async ({
      page,
      request,
    }) => {
      test.skip(!shouldRunE2E(), "Skipped: set RUN_E2E=1 to run write/OpenAI E2E");
      test.setTimeout(180_000);

      const health = await fetchHealth(request);
      expect(health.status).toBe(200);
      assertDbReady(health.body);

      await page.goto("/");
      await fillApiKeyPanel(page);
      await selectGrade(page, grade);

      const startName =
        grade === "K"
          ? /Start Kindergarten diagnostic/
          : new RegExp(`Start Grade ${grade} diagnostic`);
      await page.getByRole("button", { name: startName }).click();

      await expect(page).toHaveURL(/\/test/);
      await expect(page.getByText(/Question 1 of \d+/)).toBeVisible({
        timeout: 90_000,
      });
      const gradeLabel = grade === "K" ? "K" : grade;
      await expect(page.getByText(new RegExp(`Grade ${gradeLabel} diagnostic`))).toBeVisible();

      // Answer and submit so we also confirm grade is persisted on results.
      for (let i = 0; i < 8; i++) {
        if (await page.getByRole("heading", { name: /You scored / }).count()) break;
        await expect(page.getByText(/Question \d+ of \d+/)).toBeVisible();
        await answerCurrentQuestionAndAdvance(page);
      }
      await expect(page).toHaveURL(/\/results/, { timeout: 90_000 });
      await expect(page.getByText(new RegExp(`Grade ${gradeLabel} results`))).toBeVisible();
    });
  }
});
