import { expect, test } from "@playwright/test";
import {
  loadE2ESession,
  maskApiKeyInputs,
  noSecretCapture,
  shouldRunE2E,
} from "./helpers";

/**
 * Teacher session-code flow. Reuses the session created by
 * diagnostic-submit.spec.ts (local artifact). Does NOT start or submit a
 * new diagnostic. Gated behind RUN_E2E=1.
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
    await maskApiKeyInputs(page);
    await expect(
      page.getByRole("heading", { name: "Plan from student diagnostic" }),
    ).toBeVisible();
    const codeInput = page.getByPlaceholder("e.g. A1B2C3D4");
    await codeInput.fill(session.shortCode);
    await page.getByRole("button", { name: "Open session" }).click();

    await expect(
      page.getByRole("heading", { name: "Student snapshot" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator("span.font-mono", { hasText: session.shortCode }),
    ).toBeVisible();
    const snapshot = page.locator("p").filter({
      hasText: new RegExp(
        `Grade ${session.grade} · ${session.score}/${session.total} \\(${session.percent}%\\)`,
      ),
    });
    await expect(snapshot).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Focus skill" }),
    ).toBeVisible();
  });
});
