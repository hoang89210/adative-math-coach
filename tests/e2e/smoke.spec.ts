import { expect, test } from "@playwright/test";
import { dbOkValue, fetchHealth, redactHealth } from "./helpers";

/**
 * Read-only smoke: page loads + GET /api/health.
 * Safe to run against production. Does not submit diagnostics or call OpenAI.
 */
test.describe("Smoke (read-only)", () => {
  test("Student / loads the diagnostic home", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Three roles. One learning system." }),
    ).toBeVisible();
    await expect(page.getByText("Adaptive Math Coach")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Student · start diagnostic (K–12)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your OpenAI API key (optional)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Start Grade 4 diagnostic/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Open Teacher/ })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Open Quality Lab/ }),
    ).toBeVisible();
  });

  test("Teacher /teacher loads the session-code console", async ({ page }) => {
    await page.goto("/teacher");
    await expect(
      page.getByRole("heading", { name: "Plan from student diagnostic" }),
    ).toBeVisible();
    await expect(page.getByText("Teacher console")).toBeVisible();
    await expect(
      page.getByPlaceholder("e.g. A1B2C3D4"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open session" }),
    ).toBeVisible();
  });

  test("Lab /lab loads the Quality Lab", async ({ page }) => {
    await page.goto("/lab");
    await expect(
      page.getByRole("heading", { name: "Evaluate AI content quality" }),
    ).toBeVisible();
    await expect(page.getByText("Quality Lab · Giáo vụ")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Math standards alignment" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Grade-level appropriateness" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Standalone paste" }),
    ).toBeVisible();
  });

  test("GET /api/health returns JSON (record dbOk; do not fail on false)", async ({
    request,
  }, testInfo) => {
    const { status, body } = await fetchHealth(request);
    const safe = redactHealth(body);
    const dbOk = dbOkValue(body);
    // Attach redacted health for the QA report. Never includes secrets.
    await testInfo.attach("health.json", {
      body: JSON.stringify(safe, null, 2),
      contentType: "application/json",
    });
    console.log("[smoke] /api/health (redacted):", JSON.stringify(safe));
    console.log("[smoke] dbOk:", dbOk, "ok:", body.ok);

    expect(status, "health should return HTTP 200").toBe(200);
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("env");
    expect(body).toHaveProperty("data");
    expect(body.data?.mathIndexExists).toBe(true);
    expect(body.env?.acceptsUserApiKey).toBe(true);
    expect(typeof body.env?.sessionStore).toBe("string");
    // dbOk:true is a precondition for write E2E, not a smoke failure.
    // Current prod may still report dbOk:false (Postgres not connected).
    expect(
      dbOk === true || dbOk === false || dbOk === null,
      `env.dbOk / okDb should be boolean or null, got ${String(dbOk)}`,
    ).toBeTruthy();
  });

  test("Teacher rejects an unknown session code without writing data", async ({
    page,
  }) => {
    await page.goto("/teacher");
    await page.getByPlaceholder("e.g. A1B2C3D4").fill("ZZZZNOTREAL");
    await page.getByRole("button", { name: "Open session" }).click();
    await expect(page.locator("p").filter({ hasText: /session not found/i })).toBeVisible();
  });
});
