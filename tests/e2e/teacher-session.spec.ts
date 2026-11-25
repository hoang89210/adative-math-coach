import { expect, test } from "@playwright/test";
import {
  loadE2ESession,
  noSecretCapture,
  shouldRunE2E,
} from "./helpers";

/**
 * Teacher session-code flow. Reuses the session created by
 * diagnostic-submit.spec.ts (local artifact). Does NOT start or submit a
 * new diagnostic — that would exceed the prod submit cap of 2.
 *
 * Run after diagnostic-submit (RUN_E2E=1). The unknown-code case lives in
 * smoke.spec.ts (read-only).
 */
test.use(noSecretCapture);

test.describe("Teacher session code flow", () => {
  test.skip(!shouldRunE2E(), "Skipped: set RUN_E2E=1 to run write/OpenAI E2E");

  test("Results code opens Teacher snapshot", async ({ page }) => {
    test.setTimeout(60_000);
    const saved = loadE2ESession();
    test.skip(
      !saved?.shortCode || !saved.sessionId,
      "No saved session artifact — run diagnostic-submit.spec.ts first",
    );
    const session = saved!;
    console.log("[e2e] teacher using", session.label, session.shortCode);

    await page.goto("/teacher");
    await expect(
      page.getByRole("heading", { name: "Plan from student diagnostic" }),
    ).toBeVisible();
    const codeInput = page.getByPlaceholder("e.g. A1B2C3D4");
    await codeInput.fill(session.shortCode);
    await page.getByRole("button", { name: "Open session" }).click();

    await expect(page.getByRole("heading", { name: "Student snapshot" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("span.font-mono", { hasText: session.shortCode })).toBeVisible();
    await expect(page.getByText(new RegExp(`Grade ${session.grade}`))).toBeVisible();
    if (session.score != null && session.total != null) {
      await expect(
        page.getByText(new RegExp(`${session.score}/${session.total}`)),
      ).toBeVisible();
    }
    if (session.percent != null) {
      await expect(page.getByText(new RegExp(`\\(${session.percent}%\\)`))).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Focus skill" })).toBeVisible();
  });
});
