import { expect, test } from "@playwright/test";
import { dbOkValue, fetchHealth, redactHealth } from "./helpers";

/**
 * Read-only smoke: page loads + GET /api/health + GET /api/config.
 * Safe against local server or any allowed target. Does not call OpenAI.
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
    await expect(page.getByPlaceholder("e.g. A1B2C3D4")).toBeVisible();
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

  test("Progress /progress loads learner sign-in page", async ({ page }) => {
    await page.goto("/progress");
    await expect(
      page.getByRole("heading", { name: "Your progress" }),
    ).toBeVisible();
    await expect(page.getByPlaceholder("MATH-XXXXXX")).toBeVisible();
  });

  test("GET /api/health returns current schema (ok/okContent/okDb/key flags)", async ({
    request,
  }, testInfo) => {
    const { status, body } = await fetchHealth(request);
    const safe = redactHealth(body);
    const dbOk = dbOkValue(body);
    await testInfo.attach("health.json", {
      body: JSON.stringify(safe, null, 2),
      contentType: "application/json",
    });
    console.log("[smoke] /api/health (redacted):", JSON.stringify(safe));

    expect(status, "health should return HTTP 200").toBe(200);
    expect(typeof body.ok).toBe("boolean");
    expect(typeof body.okContent).toBe("boolean");
    expect(body.okContent).toBe(true);
    expect(body).toHaveProperty("okDb");
    expect(dbOk === true || dbOk === false || dbOk === null).toBeTruthy();
    expect(body.env?.dbOk).toBe(body.okDb);

    expect(typeof body.serverTestKeyEnabled).toBe("boolean");
    expect(typeof body.serverKeyFallbackEnabled).toBe("boolean");
    expect(body.env?.serverTestKeyEnabled).toBe(body.serverTestKeyEnabled);
    expect(body.env?.serverKeyFallbackEnabled).toBe(body.serverKeyFallbackEnabled);

    if (body.okDb === false) {
      expect(typeof body.dbError).toBe("string");
      expect(body.dbError!.length).toBeGreaterThan(0);
    } else {
      expect(body.dbError).toBeUndefined();
    }

    expect(body.data?.mathIndexExists).toBe(true);
    expect(body.env?.acceptsUserApiKey).toBe(true);
    expect(typeof body.env?.sessionStore).toBe("string");
  });

  test("GET /api/config returns key-mode booleans matching /api/health", async ({
    request,
  }) => {
    const [cfgRes, health] = await Promise.all([
      request.get("/api/config"),
      fetchHealth(request),
    ]);
    expect(cfgRes.status()).toBe(200);
    const cfg = (await cfgRes.json()) as {
      serverTestKeyEnabled?: unknown;
      serverKeyFallbackEnabled?: unknown;
    };
    expect(typeof cfg.serverTestKeyEnabled).toBe("boolean");
    expect(typeof cfg.serverKeyFallbackEnabled).toBe("boolean");
    expect(cfg.serverTestKeyEnabled).toBe(health.body.serverTestKeyEnabled);
    expect(cfg.serverKeyFallbackEnabled).toBe(
      health.body.serverKeyFallbackEnabled,
    );
  });

  test("Teacher rejects an unknown session code without writing data", async ({
    page,
  }) => {
    await page.goto("/teacher");
    await page.getByPlaceholder("e.g. A1B2C3D4").fill("ZZZZNOTREAL");
    await page.getByRole("button", { name: "Open session" }).click();
    await expect(
      page.locator("p").filter({ hasText: /session not found/i }),
    ).toBeVisible();
  });
});
