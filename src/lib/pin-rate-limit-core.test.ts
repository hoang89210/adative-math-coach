import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PIN_LOGIN_MAX_FAILURES,
  PIN_LOGIN_WINDOW_MS,
  clearMemoryFailures,
  getClientIp,
  inspectMemoryRateLimit,
  pinLoginRateKey,
  recordMemoryFailure,
  toRateLimitResult,
  type MemoryEntry,
} from "./pin-rate-limit-core.ts";

describe("pinLoginRateKey / getClientIp", () => {
  it("normalizes IP and learner code", () => {
    assert.equal(
      pinLoginRateKey("::ffff:1.2.3.4", "  ab12cd "),
      "pin-login:1.2.3.4:AB12CD",
    );
  });

  it("uses the first x-forwarded-for hop", () => {
    const request = new Request("https://example.test/api/learners", {
      headers: {
        "x-forwarded-for": "  8.8.8.8, 10.0.0.1",
        "x-real-ip": "9.9.9.9",
      },
    });
    assert.equal(getClientIp(request), "8.8.8.8");
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
