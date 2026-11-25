import { expect, test } from "@playwright/test";
import {
  dbOkValue,
  fetchHealth,
  redactHealth,
  shouldRunHardening,
} from "./helpers";

/**
 * Optional remote hardening checks (when targeting a live remote preview/prod
 * with RUN_HARDENING=1 and E2E_ALLOW_REMOTE=1). Local equivalent checks run
 * by default in smoke.spec.ts and auth-and-key-paths.spec.ts.
 */
test.describe("Remote hardening checks (RUN_HARDENING=1)", () => {
  test.skip(
    !shouldRunHardening(),
    "Skipped: set RUN_HARDENING=1 to run remote hardening probe",
  );

  test("health includes okContent, okDb, key flags, and sanitized dbError on failure", async ({
    request,
  }, testInfo) => {
    const { status, body } = await fetchHealth(request);
    const safe = redactHealth(body);
    await testInfo.attach("health.hardening.json", {
      body: JSON.stringify(safe, null, 2),
      contentType: "application/json",
    });
    console.log("[hardening] /api/health (redacted):", JSON.stringify(safe));

    expect(status).toBe(200);
    expect(typeof body.okContent).toBe("boolean");
    expect(body.okContent).toBe(true);
    expect(body).toHaveProperty("okDb");
    const okDb = body.okDb;
    expect(okDb === true || okDb === false || okDb === null).toBeTruthy();
    expect(dbOkValue(body)).toBe(okDb);
    expect(typeof body.serverTestKeyEnabled).toBe("boolean");
    expect(typeof body.serverKeyFallbackEnabled).toBe("boolean");

    if (okDb === false) {
      expect(typeof body.dbError).toBe("string");
      expect(body.dbError!.length).toBeGreaterThan(0);
      expect(body.dbError).not.toMatch(/postgres(?:ql)?:\/\//i);
      expect(body.dbError).not.toMatch(/password=/i);
      expect(body.dbError).not.toMatch(/sk-[A-Za-z0-9]/);
      expect(body.dbError).not.toMatch(/Bearer\s+/i);
    } else {
      expect(body.dbError).toBeUndefined();
    }
  });

  test("PIN login is rate-limited (429 + Retry-After 900) after repeated failures", async ({
    request,
  }) => {
    const fakeCode = `MATH-E2E${Date.now().toString(16).slice(-4)}`.slice(0, 11);
    const pin = "0000";
    let saw429 = false;
    let lastStatus = 0;

    for (let i = 0; i < 6; i++) {
      const res = await request.post("/api/learners", {
        data: { action: "login", code: fakeCode, pin },
        headers: { "Content-Type": "application/json" },
      });
      lastStatus = res.status();
      if (lastStatus === 429) {
        saw429 = true;
        const retryAfter = Number(res.headers()["retry-after"]);
        expect(retryAfter).toBeGreaterThanOrEqual(890);
        expect(retryAfter).toBeLessThanOrEqual(900);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toMatch(/too many login attempts/i);
        break;
      }
      expect([401, 503]).toContain(lastStatus);
    }

    expect(
      saw429,
      `Expected HTTP 429 after repeated PIN failures; last status was ${lastStatus}`,
    ).toBe(true);
  });
});
