import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  DEFAULT_DB_FAIL_BACKOFF_MS,
  computeDbFailRetryAfterSec,
  dbFailFastResponseInit,
  getDbFailBackoffMs,
  setDbUnavailableUntilForTests,
} from "./client";

afterEach(() => {
  setDbUnavailableUntilForTests(0);
  delete process.env.DB_FAIL_BACKOFF_MS;
});

describe("computeDbFailRetryAfterSec", () => {
  test("uses ceil of the remaining cooldown when that info is present", () => {
    assert.equal(computeDbFailRetryAfterSec(1_000, 2_500, 5_000), 2);
    assert.equal(computeDbFailRetryAfterSec(1_000, 2_000, 5_000), 1);
    assert.equal(computeDbFailRetryAfterSec(1_000, 1_200, 5_000), 1);
  });

  test("falls back to the full backoff window when remaining-time info is missing", () => {
    assert.equal(computeDbFailRetryAfterSec(1_000, 0, 5_000), 5);
    assert.equal(computeDbFailRetryAfterSec(1_000, 500, 5_000), 5);
    assert.equal(computeDbFailRetryAfterSec(1_000, 0, 1_500), 2);
  });
});

describe("dbFailFastResponseInit — 503 Retry-After", () => {
  test("sets status 503 and Retry-After to the remaining cooldown seconds", () => {
    const now = 10_000;
    setDbUnavailableUntilForTests(now + 3_200);
    const init = dbFailFastResponseInit(now);
    assert.equal(init.status, 503);
    assert.equal(init.headers["Retry-After"], "4");
  });

  test("uses the full backoff when no cooldown is active", () => {
    setDbUnavailableUntilForTests(0);
    const init = dbFailFastResponseInit(Date.now());
    assert.equal(init.status, 503);
    const expected = String(
      Math.max(1, Math.ceil(getDbFailBackoffMs() / 1000)),
    );
    assert.equal(init.headers["Retry-After"], expected);
    assert.equal(Number(init.headers["Retry-After"]), Math.ceil(DEFAULT_DB_FAIL_BACKOFF_MS / 1000));
  });
});
