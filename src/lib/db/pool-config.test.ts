import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPoolConfig } from "./pool-config.ts";

describe("buildPoolConfig", () => {
  it("treats sslmode=require as encrypt-without-verify and strips ssl params", () => {
    const raw =
      "postgres://coach:s3cret@db.example.com:6543/postgres?sslmode=require&pgbouncer=true";
    const out = buildPoolConfig(raw, {});
    assert.deepEqual(out.ssl, { rejectUnauthorized: false });
    assert.equal(new URL(out.connectionString).searchParams.get("sslmode"), null);
    assert.equal(new URL(out.connectionString).searchParams.get("pgbouncer"), "true");
    assert.doesNotMatch(out.connectionString, /sslmode/);
  });

  it("treats sslmode=no-verify the same (encrypt, no verify)", () => {
    const out = buildPoolConfig(
      "postgresql://coach:s3cret@db.example.com:6543/postgres?sslmode=no-verify",
      {},
    );
    assert.deepEqual(out.ssl, { rejectUnauthorized: false });
    assert.equal(new URL(out.connectionString).searchParams.get("sslmode"), null);
  });

  it("disables SSL for sslmode=disable", () => {
    const out = buildPoolConfig(
      "postgres://coach:s3cret@db.example.com:5432/postgres?sslmode=disable",
      {},
    );
    assert.equal(out.ssl, undefined);
    assert.doesNotMatch(out.connectionString, /sslmode/);
  });

  it("disables SSL for localhost even when sslmode is require", () => {
    const out = buildPoolConfig(
      "postgres://coach:s3cret@localhost:5432/postgres?sslmode=require",
      {},
    );
    assert.equal(out.ssl, undefined);
  });

  it("disables SSL for 127.0.0.1 when no sslmode is present", () => {
    const out = buildPoolConfig("postgres://coach:s3cret@127.0.0.1:5432/postgres", {});
    assert.equal(out.ssl, undefined);
  });

  it("uses encrypt-without-verify when no sslmode is present on a remote host", () => {
    const out = buildPoolConfig(
      "postgres://coach:s3cret@db.example.com:6543/postgres",
      {},
    );
    assert.deepEqual(out.ssl, { rejectUnauthorized: false });
    assert.equal(out.connectionString, "postgres://coach:s3cret@db.example.com:6543/postgres");
  });

  it("preserves a password that contains percent-encoded special characters", () => {
    // password is p@ss:w/rd?x  — encoded in the URI as p%40ss%3Aw%2Frd%3Fx
    const raw =
      "postgres://coach:p%40ss%3Aw%2Frd%3Fx@db.example.com:6543/postgres?sslmode=require&sslrootcert=/tmp/ca.pem";
    const out = buildPoolConfig(raw, {});
    const parsed = new URL(out.connectionString);
    assert.equal(parsed.password, "p%40ss%3Aw%2Frd%3Fx");
    assert.equal(decodeURIComponent(parsed.password), "p@ss:w/rd?x");
    assert.equal(parsed.username, "coach");
    assert.equal(parsed.searchParams.get("sslmode"), null);
    assert.equal(parsed.searchParams.get("sslrootcert"), null);
    assert.deepEqual(out.ssl, { rejectUnauthorized: false });
  });

  it("verifies TLS when DATABASE_CA_CERT is provided", () => {
    const out = buildPoolConfig(
      "postgres://coach:s3cret@db.example.com:6543/postgres?sslmode=require",
      { DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----" },
    );
    assert.equal(out.ssl && typeof out.ssl === "object" && out.ssl.rejectUnauthorized, true);
    assert.ok(out.ssl && typeof out.ssl === "object" && out.ssl.ca?.includes("BEGIN CERTIFICATE"));
  });
});
