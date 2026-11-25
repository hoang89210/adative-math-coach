import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PIN_CODE_MAX_FAILURES,
  PIN_LOGIN_MAX_FAILURES,
  PIN_LOGIN_WINDOW_MS,
  clearMemoryFailures,
  decidePinLogin,
  getClientIp,
  inspectMemoryRateLimit,
  pinLoginCodeRateKey,
  pinLoginRateKey,
  recordMemoryFailure,
  toRateLimitResult,
  type MemoryEntry,
} from "./pin-rate-limit-core.ts";

function requestWith(headers: Record<string, string>) {
  return new Request("https://example.test/api/learners", { headers });
}

describe("pinLoginRateKey / getClientIp", () => {
  it("normalizes IP and learner code", () => {
    assert.equal(
      pinLoginRateKey("::ffff:1.2.3.4", "  ab12cd "),
      "pin-login:1.2.3.4:AB12CD",
    );
    assert.equal(pinLoginCodeRateKey("  ab12cd "), "pin-login-code:AB12CD");
  });

  it("prefers x-vercel-forwarded-for over x-real-ip and a spoofed XFF first hop", () => {
    const request = requestWith({
      "x-forwarded-for": "8.8.8.8, 10.0.0.1",
      "x-real-ip": "9.9.9.9",
      "x-vercel-forwarded-for": "203.0.113.10",
    });
    assert.equal(getClientIp(request), "203.0.113.10");
  });

  it("prefers x-real-ip over X-Forwarded-For", () => {
    const request = requestWith({
      "x-forwarded-for": "8.8.8.8, 10.0.0.1",
      "x-real-ip": "9.9.9.9",
    });
    assert.equal(getClientIp(request), "9.9.9.9");
  });

  it("uses the last X-Forwarded-For hop when platform headers are absent", () => {
    const request = requestWith({
      "x-forwarded-for": "8.8.8.8, 10.0.0.1, 198.51.100.20",
    });
    assert.equal(getClientIp(request), "198.51.100.20");
  });
});

describe("memory / window limiter", () => {
  it("allows up to MAX failures then limits with Retry-After", () => {
    const store = new Map<string, MemoryEntry>();
    const now = 1_700_000_000_000;
    let result;
    for (let i = 0; i < PIN_LOGIN_MAX_FAILURES; i++) {
      result = recordMemoryFailure(store, "k", now);
    }
    assert.equal(result!.limited, true);
    assert.equal(result!.remaining, 0);
    assert.equal(result!.retryAfterSec, Math.ceil(PIN_LOGIN_WINDOW_MS / 1000));
    const inspect = inspectMemoryRateLimit(store, "k", now + 1000);
    assert.equal(inspect.limited, true);
    assert.equal(inspect.retryAfterSec, Math.ceil((PIN_LOGIN_WINDOW_MS - 1000) / 1000));
  });

  it("stays locked for 15 minutes even if the correct PIN is entered", () => {
    const store = new Map<string, MemoryEntry>();
    const now = 1_700_000_000_000;
    for (let i = 0; i < PIN_LOGIN_MAX_FAILURES; i++) {
      assert.notEqual(decidePinLogin(store, "1.1.1.1", "AB12", now, false).status, "ok");
    }
    assert.equal(decidePinLogin(store, "1.1.1.1", "AB12", now + 1_000, true).status, "429");
    assert.equal(
      decidePinLogin(store, "1.1.1.1", "AB12", now + PIN_LOGIN_WINDOW_MS - 1, true).status,
      "429",
    );
    assert.equal(
      decidePinLogin(store, "1.1.1.1", "AB12", now + PIN_LOGIN_WINDOW_MS, true).status,
      "ok",
    );
  });

  it("IP+code layer still locks after 5 failures from the same IP (under the per-code cap)", () => {
    const store = new Map<string, MemoryEntry>();
    const now = 1_700_000_000_000;
    let last = { status: "401" as const, retryAfterSec: 0 };
    for (let i = 0; i < PIN_LOGIN_MAX_FAILURES; i++) {
      last = decidePinLogin(store, "10.0.0.1", "AB12", now, false);
    }
    assert.equal(last.status, "429");
    assert.ok(last.retryAfterSec > 0);
    // Same IP is locked even though the code layer has only 5 (< 10) failures.
    assert.equal(decidePinLogin(store, "10.0.0.1", "AB12", now, true).status, "429");
    // A different IP can still try until the per-code layer fills.
    assert.equal(decidePinLogin(store, "10.0.0.2", "AB12", now, false).status, "401");
  });

  it("locks a learner code after 10 failures from changing IPs", () => {
    const store = new Map<string, MemoryEntry>();
    const now = 1_700_000_000_000;
    let last = { status: "401" as const, retryAfterSec: 0 };
    for (let i = 0; i < PIN_CODE_MAX_FAILURES; i++) {
      last = decidePinLogin(store, `203.0.113.${i + 1}`, "AB12", now, false);
    }
    assert.equal(last.status, "429");
    // A new IP is still locked by the per-code layer.
    assert.equal(decidePinLogin(store, "198.51.100.9", "AB12", now, false).status, "429");
    // Correct PIN during the per-code lock also 429s and does not clear.
    const correct = decidePinLogin(store, "198.51.100.9", "AB12", now + 1_000, true);
    assert.equal(correct.status, "429");
    assert.ok(correct.retryAfterSec > 0);
    assert.equal(
      decidePinLogin(store, "198.51.100.9", "AB12", now + PIN_LOGIN_WINDOW_MS - 1, true)
        .status,
      "429",
    );
    assert.equal(
      decidePinLogin(store, "198.51.100.9", "AB12", now + PIN_LOGIN_WINDOW_MS, true)
        .status,
      "ok",
    );
  });

  it("resets after the window and after a clear", () => {
    const store = new Map<string, MemoryEntry>();
    const now = 1_700_000_000_000;
    for (let i = 0; i < PIN_LOGIN_MAX_FAILURES; i++) {
      recordMemoryFailure(store, "k", now);
    }
    const later = toRateLimitResult(5, now, now + PIN_LOGIN_WINDOW_MS);
    assert.equal(later.limited, false);
    assert.equal(later.remaining, PIN_LOGIN_MAX_FAILURES);

    const afterWindow = recordMemoryFailure(store, "k", now + PIN_LOGIN_WINDOW_MS);
    assert.equal(afterWindow.limited, false);
    assert.equal(afterWindow.remaining, PIN_LOGIN_MAX_FAILURES - 1);

    clearMemoryFailures(store, "k");
    assert.equal(inspectMemoryRateLimit(store, "k", now + PIN_LOGIN_WINDOW_MS).limited, false);
    assert.equal(
      inspectMemoryRateLimit(store, "k", now + PIN_LOGIN_WINDOW_MS).remaining,
      PIN_LOGIN_MAX_FAILURES,
    );
  });
});
