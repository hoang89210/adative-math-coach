import { expect, test } from "@playwright/test";
import {
  dbOkValue,
  fetchHealth,
  redactHealth,
  shouldRunHardening,
} from "./helpers";

/**
 * Later checks for Thọ's hardening PR (local branch
 * fix/health-dberror-pin-ratelimit, not yet on production main):
 *  - GET /api/health exposes okContent, okDb, and sanitized dbError
 *  - PIN login rate-limit returns 429 after repeated failures
 *
 * Skipped unless RUN_HARDENING=1 so default smoke against current prod
 * does not fail before the PR is deployed. Point BASE_URL at a preview
 * deploy or local `npm run dev` of that branch when running these.
 *
 * PIN test hits /api/learners with a fake code. It does not create a
 * learner, but it increments the rate-limit counter for (IP + code).
 * Use a dedicated fake code; do not hammer production.
 */
test.describe("Thọ hardening PR checks", () => {
  test.skip(
    !shouldRunHardening(),
    "Skipped: set RUN_HARDENING=1 after Thọ's health/PIN PR is available on BASE_URL",
  );

  test("health includes okContent, okDb, and dbError when DB check fails", async ({
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
    expect(body, "okContent should be a top-level boolean").toHaveProperty(
      "okContent",
    );
    expect(typeof body.okContent).toBe("boolean");
    expect(body.okContent).toBe(true);

    expect(body, "okDb should be present at the top level").toHaveProperty("okDb");
    const okDb = body.okDb;
    expect(okDb === true || okDb === false || okDb === null).toBeTruthy();
    expect(dbOkValue(body)).toBe(okDb);

    if (okDb === false) {
      expect(
        typeof body.dbError,
        "when okDb is false, dbError must explain the failure",
      ).toBe("string");
      expect(body.dbError!.length).toBeGreaterThan(0);
      // Sanitization: no credentials / URIs / tokens in the message.
      expect(body.dbError).not.toMatch(/postgres(?:ql)?:\/\//i);
      expect(body.dbError).not.toMatch(/password=/i);
      expect(body.dbError).not.toMatch(/sk-[A-Za-z0-9]/);
      expect(body.dbError).not.toMatch(/Bearer\s+/i);
    } else {
      expect(body.dbError, "dbError should be omitted when okDb is not false").toBeUndefined();
    }
  });

  test("PIN login is rate-limited after repeated failures", async ({
    request,
  }) => {
    // Matches Thọ's pin-rate-limit-core: 5 failures / 15-minute window.
    const fakeCode = `MATH-E2E${Date.now().toString(16).slice(-4)}`.slice(0, 11);
    const pin = "0000";
    let saw429 = false;
    let lastStatus = 0;
    let lastBody: { error?: string } = {};

    for (let i = 0; i < 8; i++) {
      const res = await request.post("/api/learners", {
        data: { action: "login", code: fakeCode, pin },
        headers: { "Content-Type": "application/json" },
      });
      lastStatus = res.status();
      lastBody = (await res.json().catch(() => ({}))) as { error?: string };
      if (lastStatus === 429) {
        saw429 = true;
        const retryAfter = res.headers()["retry-after"];
        expect(retryAfter, "429 should include Retry-After").toBeTruthy();
        expect(lastBody.error).toMatch(/too many login attempts/i);
        break;
      }
      // Before the limit, invalid code/PIN is 401 (or 500 if DB is down).
      expect([401, 500]).toContain(lastStatus);
    }

    expect(
      saw429,
      `Expected HTTP 429 after repeated PIN failures; last status was ${lastStatus} (${lastBody.error ?? "no error field"})`,
    ).toBe(true);
  });
});
