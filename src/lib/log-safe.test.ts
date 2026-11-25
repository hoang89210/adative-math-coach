import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactForLog, redactHeaders, scrubMeta } from "./log-safe.ts";

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
