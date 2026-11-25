import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { redactSecrets } from "./redact";
import { getClientIp } from "./request-ip";
import {
  MemoryWindowLimiter,
  checkServerTestKeyAccess,
  isServerTestKeyEnabled,
  parseAllowServerTestKeyFlag,
  selectLlmApiKey,
  wantsServerTestKey,
} from "./server-test-key";

const SERVER_KEY = "sk-test-SERVER-key-abcdefghijklmnopqrstuvwxyz";
const USER_KEY = "sk-test-USER-key-abcdefghijklmnopqrstuvwxyz";

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ALLOW_SERVER_TEST_KEY;
});

function req(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/diagnostic/generate", {
    method: "POST",
    headers,
  });
}

describe("parseAllowServerTestKeyFlag", () => {
  test("is off by default and for empty / unknown values", () => {
    assert.equal(parseAllowServerTestKeyFlag(undefined), false);
    assert.equal(parseAllowServerTestKeyFlag(""), false);
    assert.equal(parseAllowServerTestKeyFlag("0"), false);
    assert.equal(parseAllowServerTestKeyFlag("false"), false);
    assert.equal(parseAllowServerTestKeyFlag("maybe"), false);
  });

  test("treats 1 / true / yes / on as enabled (case-insensitive)", () => {
    assert.equal(parseAllowServerTestKeyFlag("1"), true);
    assert.equal(parseAllowServerTestKeyFlag("true"), true);
    assert.equal(parseAllowServerTestKeyFlag("YES"), true);
    assert.equal(parseAllowServerTestKeyFlag("On"), true);
  });
});

describe("isServerTestKeyEnabled", () => {
  test("requires both the flag and a server key", () => {
    assert.equal(isServerTestKeyEnabled(false, true), false);
    assert.equal(isServerTestKeyEnabled(true, false), false);
    assert.equal(isServerTestKeyEnabled(true, true), true);
    assert.equal(isServerTestKeyEnabled(false, false), false);
  });
});

describe("selectLlmApiKey", () => {
  test("rejects server-key mode when the flag is off", () => {
    const result = selectLlmApiKey({
      useServerKey: true,
      allowServerTestKey: false,
      serverKey: SERVER_KEY,
      userKey: USER_KEY,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.doesNotMatch(result.error, /sk-/);
      assert.equal(result.error.includes(SERVER_KEY), false);
    }
    assert.equal("key" in result, false);
  });

  test("rejects server-key mode when the server has no OPENAI_API_KEY", () => {
    const result = selectLlmApiKey({
      useServerKey: true,
      allowServerTestKey: true,
      serverKey: "",
      userKey: USER_KEY,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.error.includes(USER_KEY), false);
    }
    assert.equal("key" in result, false);
  });

  test("uses the server key only when flag is on and the key exists", () => {
    const result = selectLlmApiKey({
      useServerKey: true,
      allowServerTestKey: true,
      serverKey: SERVER_KEY,
      userKey: USER_KEY,
      envKey: SERVER_KEY,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "server");
      assert.equal(result.key, SERVER_KEY);
    }
  });

  test("uses the user key when server-key mode is not requested", () => {
    const result = selectLlmApiKey({
      useServerKey: false,
      allowServerTestKey: true,
      serverKey: SERVER_KEY,
      userKey: USER_KEY,
      envKey: SERVER_KEY,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "user");
      assert.equal(result.key, USER_KEY);
    }
  });

  test("falls back to env key when no user key is provided", () => {
    const result = selectLlmApiKey({
      useServerKey: false,
      allowServerTestKey: false,
      serverKey: SERVER_KEY,
      envKey: SERVER_KEY,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "env");
    }
  });

  test("errors when no key is available and server-key mode is off", () => {
    const result = selectLlmApiKey({
      useServerKey: false,
      allowServerTestKey: false,
    });
    assert.equal(result.ok, false);
  });
});

describe("checkServerTestKeyAccess + rate limit", () => {
  test("returns 403 when the feature is disabled (does not increment the limiter)", () => {
    const limiter = new MemoryWindowLimiter(
      () => 2,
      () => 60_000,
    );
    const denied = checkServerTestKeyAccess(req(), {
      enabled: false,
      limiter,
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.status, 403);
      assert.equal(denied.retryAfter, undefined);
    }
    const afterEnable = checkServerTestKeyAccess(req(), {
      enabled: true,
      limiter,
      ip: "9.9.9.9",
    });
    assert.equal(afterEnable.ok, true);
  });

  test("allows N calls then returns 429 with Retry-After", () => {
    let now = 1_000_000;
    const limiter = new MemoryWindowLimiter(
      () => 3,
      () => 60_000,
      () => now,
    );
    const ip = "203.0.113.10";
    for (let i = 0; i < 3; i++) {
      const r = checkServerTestKeyAccess(req(), { enabled: true, limiter, ip });
      assert.equal(r.ok, true, `call ${i + 1} should be allowed`);
    }
    const blocked = checkServerTestKeyAccess(req(), {
      enabled: true,
      limiter,
      ip,
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.status, 429);
      assert.ok((blocked.retryAfter ?? 0) >= 1);
      assert.match(blocked.error, /rate limit/i);
      assert.equal(blocked.error.includes(SERVER_KEY), false);
    }

    const otherIp = checkServerTestKeyAccess(req(), {
      enabled: true,
      limiter,
      ip: "203.0.113.11",
    });
    assert.equal(otherIp.ok, true);

    now += 60_000 + 1;
    const later = checkServerTestKeyAccess(req(), { enabled: true, limiter, ip });
    assert.equal(later.ok, true);
  });
});

describe("wantsServerTestKey", () => {
  test("reads x-use-server-key header", () => {
    assert.equal(wantsServerTestKey(req()), false);
    assert.equal(wantsServerTestKey(req({ "x-use-server-key": "1" })), true);
    assert.equal(wantsServerTestKey(req({ "x-use-server-key": "true" })), true);
    assert.equal(wantsServerTestKey(req({ "x-use-server-key": "0" })), false);
  });
});

describe("getClientIp", () => {
  test("prefers x-vercel-forwarded-for over spoofable X-Forwarded-For", () => {
    const ip = getClientIp(
      req({
        "x-forwarded-for": "1.1.1.1, 8.8.8.8",
        "x-vercel-forwarded-for": "203.0.113.5",
      }),
    );
    assert.equal(ip, "203.0.113.5");
  });

  test("uses x-real-ip when vercel header is missing", () => {
    const ip = getClientIp(
      req({
        "x-forwarded-for": "1.1.1.1, 8.8.8.8",
        "x-real-ip": "203.0.113.6",
      }),
    );
    assert.equal(ip, "203.0.113.6");
  });

  test("uses the last hop of X-Forwarded-For, not the first", () => {
    const ip = getClientIp(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 9.9.9.9" }));
    assert.equal(ip, "9.9.9.9");
  });

  test("returns unknown when no IP headers are present", () => {
    assert.equal(getClientIp(req()), "unknown");
  });
});

describe("redactSecrets", () => {
  test("strips sk- keys and env OPENAI_API_KEY from strings", () => {
    process.env.OPENAI_API_KEY = SERVER_KEY;
    const leaked = `Incorrect API key provided: ${SERVER_KEY} also sk-proj-abc1234****ZZZ`;
    const cleaned = redactSecrets(leaked);
    assert.equal(cleaned.includes(SERVER_KEY), false);
    assert.equal(cleaned.includes("sk-proj-abc"), false);
    assert.match(cleaned, /\[redacted\]|sk-\[redacted\]/);
  });
});
