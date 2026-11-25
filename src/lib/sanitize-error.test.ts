import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeDbError } from "./sanitize-error.ts";

describe("sanitizeDbError", () => {
  it("keeps a generic pg code and message", () => {
    const err = Object.assign(new Error("password authentication failed for user \"postgres\""), {
      code: "28P01",
    });
    const out = sanitizeDbError(err);
    assert.equal(out, '28P01: password authentication failed for user "postgres"');
  });

  it("strips postgres URIs including user:password", () => {
    const err = new Error(
      "connect failed postgres://coach:s3cret-pass@db.example.com:6543/postgres?sslmode=require",
    );
    const out = sanitizeDbError(err);
    assert.doesNotMatch(out, /s3cret-pass/);
    assert.doesNotMatch(out, /postgres:\/\//);
    assert.doesNotMatch(out, /db\.example\.com/);
    assert.match(out, /\[redacted\]/);
  });

  it("strips password= assignments and DSN fragments", () => {
    const err = new Error("Pool error password=supersecret DATABASE_URL=postgres://u:p@h/db");
    const out = sanitizeDbError(err);
    assert.doesNotMatch(out, /supersecret/);
    assert.doesNotMatch(out, /postgres:\/\//);
    assert.doesNotMatch(out, /u:p@h/);
  });

  it("strips user:pass@host without a scheme", () => {
    const err = new Error("timeout talking to admin:hunter2@10.0.0.5:5432");
    const out = sanitizeDbError(err);
    assert.doesNotMatch(out, /hunter2/);
    assert.match(out, /\[redacted\]/);
  });

  it("strips API tokens and sk- keys", () => {
    const err = new Error("upstream token=tok_live_abc sk-proj-1234567890abcdef");
    const out = sanitizeDbError(err);
    assert.doesNotMatch(out, /tok_live_abc/);
    assert.doesNotMatch(out, /sk-proj-1234567890abcdef/);
  });

  it("truncates long messages", () => {
    const err = new Error("ECONNREFUSED " + "x".repeat(400));
    const out = sanitizeDbError(err);
    assert.ok(out.length <= 200);
    assert.match(out, /…$/);
  });

  it("falls back when the message is empty", () => {
    assert.equal(sanitizeDbError({}), "database check failed");
  });
});
