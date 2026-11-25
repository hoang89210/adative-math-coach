import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  redactForLog,
  redactHeaders,
  redactSecretString,
  scrubMeta,
} from "./log-safe.ts";

describe("redactHeaders", () => {
  it("redacts x-openai-api-key regardless of case", () => {
    const out = redactHeaders({
      "Content-Type": "application/json",
      "X-OpenAI-Api-Key": "sk-proj-SUPERSECRETKEYVALUE123",
      "x-openai-api-key": "sk-proj-SUPERSECRETKEYVALUE123",
    });
    assert.equal(out["X-OpenAI-Api-Key"], "[redacted]");
    assert.equal(out["x-openai-api-key"], "[redacted]");
    assert.equal(out["Content-Type"], "application/json");
    assert.doesNotMatch(JSON.stringify(out), /SUPERSECRET/);
  });

  it("redacts Authorization and cookies", () => {
    const out = redactHeaders({
      authorization: "Bearer sk-abc",
      cookie: "session=abc",
    });
    assert.equal(out.authorization, "[redacted]");
    assert.equal(out.cookie, "[redacted]");
  });
});

describe("redactSecretString — masked and full sk- keys", () => {
  it("redacts the exact OpenAI masked form sk-TESTL****...A111 so no prefix or suffix leaks", () => {
    const input = "Incorrect API key provided: sk-TESTL****...A111";
    const out = redactSecretString(input);
    assert.equal(out, "Incorrect API key provided: [redacted]");
    assert.doesNotMatch(out, /sk-/);
    assert.doesNotMatch(out, /TESTL/);
    assert.doesNotMatch(out, /\*{2,}/);
    assert.doesNotMatch(out, /A111/);
  });

  it("redacts the sk-proj- masked variant the same way", () => {
    const input = "Incorrect API key provided: sk-proj-ABCD****...Z999";
    const out = redactSecretString(input);
    assert.equal(out, "Incorrect API key provided: [redacted]");
    assert.doesNotMatch(out, /sk-proj-/);
    assert.doesNotMatch(out, /ABCD/);
    assert.doesNotMatch(out, /Z999/);
  });
});

describe("redactForLog / scrubMeta", () => {
  it("redacts nested header objects and sk- values", () => {
    const out = redactForLog({
      headers: { "x-openai-api-key": "sk-proj-nestedsecret" },
      message: "ok sk-proj-1234567890abcdef",
    }) as Record<string, unknown>;
    const headers = out.headers as Record<string, string>;
    assert.equal(headers["x-openai-api-key"], "[redacted]");
    assert.equal(out.message, "ok [redacted]");
  });

  it("redacts Error.message, stack, and cause for masked sk- and sk-proj- keys", () => {
    const cause = new Error("Incorrect API key provided: sk-proj-ABCD****...Z999");
    const err = new Error("Incorrect API key provided: sk-TESTL****...A111");
    err.cause = cause;
    const out = redactForLog(err) as Record<string, unknown>;
    const blob = JSON.stringify(out);
    assert.doesNotMatch(blob, /TESTL/);
    assert.doesNotMatch(blob, /A111/);
    assert.doesNotMatch(blob, /ABCD/);
    assert.doesNotMatch(blob, /Z999/);
    assert.doesNotMatch(blob, /sk-TESTL/);
    assert.doesNotMatch(blob, /sk-proj-ABCD/);
    assert.match(String(out.message), /\[redacted\]/);
    assert.match(String(out.stack), /\[redacted\]/);
    const caused = out.cause as Record<string, unknown>;
    assert.match(String(caused.message), /\[redacted\]/);
    assert.match(String(caused.stack), /\[redacted\]/);
  });

  it("drops sensitive keys from event meta", () => {
    const out = scrubMeta({
      grade: "4",
      "x-openai-api-key": "sk-proj-dontlog",
      pin: "1234",
      apiKey: "sk-abc",
      ok: true,
    });
    assert.equal(out.grade, "4");
    assert.equal(out.ok, true);
    assert.equal(out["x-openai-api-key"], undefined);
    assert.equal(out.pin, undefined);
    assert.equal(out.apiKey, undefined);
  });
});
