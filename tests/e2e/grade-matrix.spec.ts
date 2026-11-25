import { expect, test } from "@playwright/test";
import {
  assertDbReady,
  fetchHealth,
  fillApiKeyPanel,
  noSecretCapture,
  selectGrade,
  shouldRunE2E,
  startDiagnosticAndWaitForTest,
} from "./helpers";

/**
 * Grade matrix K, 4, 8, 10 using the yellow API-key panel.
 * Key is read from env OPENAI_API_KEY only — never printed, logged, or committed.
 * Capture (trace / screenshot / video) is forced off so the key cannot leak.
 *
 * Gated generate tests: RUN_E2E=1. They start a diagnostic (OpenAI) but do
 * NOT Submit — prod is capped at 2 real submits, reserved for
 * diagnostic-submit.spec.ts (and a spare if Hoàng asks).
 */
const GRADES = ["K", "4", "8", "10"] as const;

test.use(noSecretCapture);

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
    test(`Grade ${grade}: generate diagnostic via saved user key (no submit)`, async ({
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
      await startDiagnosticAndWaitForTest(page, startName);
      await expect(page.getByRole("heading", { name: /Question 1 of \d+/ })).toBeVisible({
        timeout: 30_000,
      });
      const gradeLabel = grade === "K" ? "K" : grade;
      await expect(
        page.getByText(`Grade ${gradeLabel} diagnostic`, { exact: true }),
      ).toBeVisible();
      // Stop here — do not answer or click Submit (prod submit cap).
      await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
      await expect(page).not.toHaveURL(/\/results/);
    });
  }
});
