import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

/**
 * When a database IS configured but is down, load/record must throw
 * (isDbTimeoutError) instead of quietly returning the in-memory store.
 * Own process so POSTGRES_URL does not leak into other test files.
 */
process.env.POSTGRES_URL = "postgres://amc:amc@127.0.0.1:1/amc?sslmode=disable";
process.env.DB_CONNECT_TIMEOUT_MS = "800";
process.env.DB_FAIL_BACKOFF_MS = "5000";
delete process.env.POSTGRES_PRISMA_URL;
delete process.env.DATABASE_URL;

const ID = "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
let store: typeof import("./lc-mastery-store");
let isDbTimeoutError: (err: unknown) => boolean;
let setDbUnavailableUntilForTests: (ts: number) => void;
let endPool: () => Promise<void>;

before(async () => {
  const db = await import("./db/client");
  isDbTimeoutError = db.isDbTimeoutError;
  setDbUnavailableUntilForTests = db.setDbUnavailableUntilForTests;
  endPool = () => db.getPool().end();
  store = await import("./lc-mastery-store");
  store.resetLcMasteryMemoryForTests();
});

after(async () => {
  try {
    await endPool();
  } catch {
    // ignore
  }
});

describe("lc-mastery-store with DB configured but down", () => {
  test("loadLcMastery throws (does not return store=memory, lcCount 0)", async () => {
    setDbUnavailableUntilForTests(0);
    store.resetLcMasteryMemoryForTests();
    await assert.rejects(
      () => store.loadLcMastery(ID),
      (err: unknown) => isDbTimeoutError(err),
    );
  });

  test("recordLcEvidence throws and does not keep a memory write", async () => {
    setDbUnavailableUntilForTests(0);
    store.resetLcMasteryMemoryForTests();
    await assert.rejects(
      () => store.recordLcEvidence(ID, [{ lcId: "lc1", dAlpha: 1, dBeta: 0 }]),
      (err: unknown) => isDbTimeoutError(err),
    );
    // After the failed write, even a subsequent load (still no DB) throws —
    // it must not start answering from a silent memory apply.
    await assert.rejects(
      () => store.loadLcMastery(ID),
      (err: unknown) => isDbTimeoutError(err),
    );
  });
});
