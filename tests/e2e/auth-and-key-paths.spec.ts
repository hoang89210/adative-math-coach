import { expect, test } from "@playwright/test";
import {
  fillApiKeyPanelWithKey,
  isRemoteTarget,
  startBlackholeTcpServer,
  startDiagnosticAndWaitForTest,
  startEphemeralAppServer,
  trackCreatedLearner,
} from "./helpers";

/**
 * Default local E2E checks for PR #1 & PR #3 behavior without calling real OpenAI:
 * - No personal key + no header -> 401 OPENAI_KEY_REQUIRED (API + UI red error)
 * - "Không có key" button / x-use-server-key (403 when flag off, 429 + Retry-After when limit hit)
 * - Canary/fake personal key -> fallback path without hitting real OpenAI
 * - PIN lock: 5 failures per IP+code and 10 per code -> 429 Retry-After 900
 * - Hung DB -> 503 with Retry-After + health ok:false, okContent:true, okDb:false, sanitized dbError
 */
test.describe("Key gating, server-test-key, PIN lock, and hung DB", () => {
  test("no personal key + no header returns 401 OPENAI_KEY_REQUIRED (API + UI red error)", async ({
    page,
    request,
  }) => {
    const cfgRes = await request.get("/api/config");
    expect(cfgRes.status()).toBe(200);
    const cfg = (await cfgRes.json()) as {
      serverTestKeyEnabled?: boolean;
      serverKeyFallbackEnabled?: boolean;
    };
    test.skip(
      Boolean(cfg.serverKeyFallbackEnabled),
      "Server key fallback is enabled on this target",
    );

    // 1) Direct API check: no key, no x-use-server-key -> 401 OPENAI_KEY_REQUIRED
    const apiRes = await request.post("/api/diagnostic/generate", {
      data: { grade: "4", jurisdiction: "Multi-State" },
    });
    expect(apiRes.status()).toBe(401);
    const body = (await apiRes.json()) as {
      code?: string;
      error?: string;
      serverTestKeyEnabled?: boolean;
    };
    expect(body.code).toBe("OPENAI_KEY_REQUIRED");
    expect(body.serverTestKeyEnabled).toBe(Boolean(cfg.serverTestKeyEnabled));
    expect(body.error).toMatch(/OpenAI API key required/i);

    // 2) UI check: confirm missing-key prompt -> red error banner appears
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("amc_openai_api_key");
      localStorage.removeItem("amc_use_server_test_key");
    });
    await page.reload();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /Start Grade 4 diagnostic/ }).click();

    const errorBanner = page.locator("p.text-red-700");
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText(/OpenAI API key required/i);
  });

  test("x-use-server-key returns 403 and Không có key button is hidden when flag is off", async ({
    page,
    request,
  }) => {
    const cfgRes = await request.get("/api/config");
    const cfg = (await cfgRes.json()) as {
      serverTestKeyEnabled?: boolean;
      serverKeyFallbackEnabled?: boolean;
    };
    test.skip(
      Boolean(cfg.serverTestKeyEnabled) || Boolean(cfg.serverKeyFallbackEnabled),
      "Server test key is enabled on this target",
    );

    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Không có key" }),
    ).toHaveCount(0);

    const res = await request.post("/api/diagnostic/generate", {
      headers: { "x-use-server-key": "1" },
      data: { grade: "4", jurisdiction: "Multi-State" },
    });
    expect(res.status()).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/Server test key is not enabled/i);
  });

  test("canary fake personal key falls back cleanly without calling real OpenAI", async ({
    page,
  }) => {
    test.skip(
      isRemoteTarget(),
      "Canary fallback test runs against local server (LLM_BASE_URL isolated)",
    );

    await page.goto("/");
    await fillApiKeyPanelWithKey(page, "sk-canary-fake-key-for-local-e2e-0000");
    await startDiagnosticAndWaitForTest(page, /Start Grade 4 diagnostic/);

    await expect(
      page.getByRole("heading", { name: /Question 1 of \d+/ }),
    ).toBeVisible();
    await expect(
      page.getByText(/Grade 4: Show understanding of —/),
    ).toBeVisible();
  });

  test("Không có key button + x-use-server-key + 429 Retry-After limit", async ({
    page,
  }) => {
    test.skip(
      isRemoteTarget(),
      "Spawns an isolated local Next server with ALLOW_SERVER_TEST_KEY=1",
    );
    test.setTimeout(60_000);

    const srv = await startEphemeralAppServer({
      ALLOW_SERVER_TEST_KEY: "1",
      OPENAI_API_KEY: "sk-canary-server-test-key-000000",
      SERVER_TEST_KEY_MAX_CALLS: "2",
      SERVER_TEST_KEY_WINDOW_MS: "60000",
      LLM_BASE_URL: "http://127.0.0.1:1/v1",
    });

    try {
      // Health & config reflect serverTestKeyEnabled: true, fallback: false
      const healthRes = await fetch(`${srv.baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      const health = (await healthRes.json()) as {
        ok?: boolean;
        okContent?: boolean;
        okDb?: boolean | null;
        serverTestKeyEnabled?: boolean;
        serverKeyFallbackEnabled?: boolean;
        env?: { hasOpenAiKey?: boolean };
      };
      expect(health.ok).toBe(true);
      expect(health.okContent).toBe(true);
      expect(health.okDb).toBeNull();
      expect(health.serverTestKeyEnabled).toBe(true);
      expect(health.serverKeyFallbackEnabled).toBe(false);
      expect(health.env?.hasOpenAiKey).toBe(true);

      const cfgRes = await fetch(`${srv.baseUrl}/api/config`);
      expect(cfgRes.status).toBe(200);
      const cfg = (await cfgRes.json()) as {
        serverTestKeyEnabled?: boolean;
        serverKeyFallbackEnabled?: boolean;
      };
      expect(cfg).toEqual({
        serverTestKeyEnabled: true,
        serverKeyFallbackEnabled: false,
      });

      // Without x-use-server-key or personal key, even when OPENAI_API_KEY is set -> 401
      const unauthRes = await fetch(`${srv.baseUrl}/api/diagnostic/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: "4", jurisdiction: "Multi-State" }),
      });
      expect(unauthRes.status).toBe(401);
      const unauthBody = (await unauthRes.json()) as {
        code?: string;
        serverTestKeyEnabled?: boolean;
      };
      expect(unauthBody.code).toBe("OPENAI_KEY_REQUIRED");
      expect(unauthBody.serverTestKeyEnabled).toBe(true);

      // UI: click "Không có key" -> status updates -> call #1 succeeds via fallback
      await page.goto(`${srv.baseUrl}/`);
      const serverKeyBtn = page.getByRole("button", { name: "Không có key" });
      await expect(serverKeyBtn).toBeVisible();
      await serverKeyBtn.click();
      await expect(
        page.getByText("đang dùng key test của server").first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Dùng key của tôi" }),
      ).toBeVisible();

      await startDiagnosticAndWaitForTest(page, /Start Grade 4 diagnostic/);
      await expect(
        page.getByRole("heading", { name: /Question 1 of \d+/ }),
      ).toBeVisible();

      // Call #2 with x-use-server-key succeeds (max=2)
      const call2 = await fetch(`${srv.baseUrl}/api/diagnostic/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-use-server-key": "1",
        },
        body: JSON.stringify({ grade: "4", jurisdiction: "Multi-State" }),
      });
      expect(call2.status).toBe(200);

      // Call #3 exceeds SERVER_TEST_KEY_MAX_CALLS=2 -> 429 + Retry-After
      const call3 = await fetch(`${srv.baseUrl}/api/diagnostic/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-use-server-key": "1",
        },
        body: JSON.stringify({ grade: "4", jurisdiction: "Multi-State" }),
      });
      expect(call3.status).toBe(429);
      const retryAfter = Number(call3.headers.get("retry-after"));
      expect(Number.isFinite(retryAfter) && retryAfter >= 1).toBe(true);
      const body3 = (await call3.json()) as { error?: string };
      expect(body3.error).toMatch(/rate limit reached/i);
    } finally {
      await srv.close();
    }
  });

  test("PIN lock: 5 failures per IP+code and 10 per code -> 429 Retry-After 900", async ({
    request,
  }) => {
    test.skip(
      isRemoteTarget(),
      "PIN lockout test runs only locally so shared remote counters are never polluted",
    );

    // Layer 1: 5 failures per IP + code
    const create1 = await request.post("/api/learners", {
      data: { action: "create", pin: "1234", grade: "4", jurisdiction: "Multi-State" },
    });
    expect(create1.status()).toBe(200);
    const learner1 = (await create1.json()) as {
      learnerId: string;
      publicCode: string;
    };
    trackCreatedLearner(learner1.learnerId);

    const ipA = "203.0.113.10";
    const ipB = "203.0.113.11";

    for (let i = 0; i < 4; i++) {
      const r = await request.post("/api/learners", {
        headers: { "x-vercel-forwarded-for": ipA },
        data: { action: "login", code: learner1.publicCode, pin: "9999" },
      });
      expect(r.status(), `attempt ${i + 1} should be 401`).toBe(401);
    }

    // 5th failure trips IP+code limit -> 429 Retry-After: 900
    const tripIp = await request.post("/api/learners", {
      headers: { "x-vercel-forwarded-for": ipA },
      data: { action: "login", code: learner1.publicCode, pin: "9999" },
    });
    expect(tripIp.status()).toBe(429);
    const retryIp = Number(tripIp.headers()["retry-after"]);
    expect(retryIp).toBeGreaterThanOrEqual(895);
    expect(retryIp).toBeLessThanOrEqual(900);
    const tripIpBody = (await tripIp.json()) as { error?: string };
    expect(tripIpBody.error).toMatch(/too many login attempts/i);

    // Correct PIN from same locked IP still gets 429
    const lockedCorrect = await request.post("/api/learners", {
      headers: { "x-vercel-forwarded-for": ipA },
      data: { action: "login", code: learner1.publicCode, pin: "1234" },
    });
    expect(lockedCorrect.status()).toBe(429);

    // Different IP with correct PIN succeeds (under per-code cap of 10)
    const okOtherIp = await request.post("/api/learners", {
      headers: { "x-vercel-forwarded-for": ipB },
      data: { action: "login", code: learner1.publicCode, pin: "1234" },
    });
    expect(okOtherIp.status()).toBe(200);

    // Layer 2: 10 failures per code across rotating IPs (each <5)
    const create2 = await request.post("/api/learners", {
      data: { action: "create", pin: "5678", grade: "8", jurisdiction: "Multi-State" },
    });
    expect(create2.status()).toBe(200);
    const learner2 = (await create2.json()) as {
      learnerId: string;
      publicCode: string;
    };
    trackCreatedLearner(learner2.learnerId);

    const rotatingIps = ["198.51.100.1", "198.51.100.2", "198.51.100.3"];
    for (const ip of rotatingIps) {
      for (let i = 0; i < 3; i++) {
        const r = await request.post("/api/learners", {
          headers: { "x-vercel-forwarded-for": ip },
          data: { action: "login", code: learner2.publicCode, pin: "0000" },
        });
        expect(r.status()).toBe(401);
      }
    }

    // 10th failure from a 4th IP trips per-code limit -> 429 Retry-After: 900
    const tripCode = await request.post("/api/learners", {
      headers: { "x-vercel-forwarded-for": "198.51.100.4" },
      data: { action: "login", code: learner2.publicCode, pin: "0000" },
    });
    expect(tripCode.status()).toBe(429);
    const retryCode = Number(tripCode.headers()["retry-after"]);
    expect(retryCode).toBeGreaterThanOrEqual(895);
    expect(retryCode).toBeLessThanOrEqual(900);

    // 11th attempt with correct PIN from brand-new IP still gets 429
    const lockedNewIp = await request.post("/api/learners", {
      headers: { "x-vercel-forwarded-for": "198.51.100.5" },
      data: { action: "login", code: learner2.publicCode, pin: "5678" },
    });
    expect(lockedNewIp.status()).toBe(429);
  });

  test("hung DB returns sanitized dbError in health and 503 + Retry-After on login", async () => {
    test.skip(
      isRemoteTarget(),
      "Spawns an isolated local Next server with a blackhole Postgres TCP socket",
    );
    test.setTimeout(60_000);

    const bh = await startBlackholeTcpServer();
    const srv = await startEphemeralAppServer({
      DATABASE_URL: `postgres://e2euser:supersecretpass@127.0.0.1:${bh.port}/amc`,
      DB_CONNECT_TIMEOUT_MS: "500",
      DB_QUERY_TIMEOUT_MS: "500",
      DB_FAIL_BACKOFF_MS: "5000",
    });

    try {
      // 1) Health check trips connect timeout -> ok:false, okContent:true, okDb:false, sanitized dbError
      const healthRes = await fetch(`${srv.baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      const health = (await healthRes.json()) as {
        ok?: boolean;
        okContent?: boolean;
        okDb?: boolean | null;
        dbError?: string;
        env?: { dbOk?: boolean | null; sessionStore?: string };
      };
      expect(health.ok).toBe(false);
      expect(health.okContent).toBe(true);
      expect(health.okDb).toBe(false);
      expect(health.env?.dbOk).toBe(false);
      expect(health.env?.sessionStore).toBe("supabase");
      expect(typeof health.dbError).toBe("string");
      expect(health.dbError!.length).toBeGreaterThan(0);
      expect(health.dbError).not.toContain("supersecretpass");
      expect(health.dbError).not.toMatch(/postgres(?:ql)?:\/\//i);

      // 2) Hung / fail-fast learner login -> 503 with Retry-After
      const login1 = await fetch(`${srv.baseUrl}/api/learners`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          code: "MATH-HUNGDB",
          pin: "1234",
        }),
      });
      expect(login1.status).toBe(503);
      const retry1 = Number(login1.headers.get("retry-after"));
      expect(Number.isFinite(retry1) && retry1 >= 1).toBe(true);
      expect(retry1).toBeLessThanOrEqual(5);

      // 3) Immediate second login uses fail-fast backoff (<1s) with 503 + Retry-After
      const t0 = Date.now();
      const login2 = await fetch(`${srv.baseUrl}/api/learners`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          code: "MATH-HUNGDB",
          pin: "1234",
        }),
      });
      const elapsed = Date.now() - t0;
      expect(login2.status).toBe(503);
      expect(elapsed).toBeLessThan(1_000);
      const retry2 = Number(login2.headers.get("retry-after"));
      expect(Number.isFinite(retry2) && retry2 >= 1).toBe(true);
    } finally {
      await srv.close();
      await bh.close();
    }
  });
});
