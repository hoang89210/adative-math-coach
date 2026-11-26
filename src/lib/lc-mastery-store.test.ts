import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import {
  isValidLearnerId,
  loadLcMastery,
  recordLcEvidence,
  resetLcMasteryMemoryForTests,
} from "./lc-mastery-store";

const ID = "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const DB_VARS = ["POSTGRES_PRISMA_URL", "POSTGRES_URL", "DATABASE_URL", "POSTGRES_URL_NON_POOLING"];

beforeEach(() => {
  for (const v of DB_VARS) delete process.env[v];
  resetLcMasteryMemoryForTests();
});

describe("lc-mastery-store without a database", () => {
  test("falls back to in-memory posteriors and accumulates", async () => {
    assert.equal(await recordLcEvidence(ID, [{ lcId: "lc1", dAlpha: 1, dBeta: 0 }]), "memory");
    await recordLcEvidence(ID, [
      { lcId: "lc1", dAlpha: 0, dBeta: 1 },
      { lcId: "lc2", dAlpha: 0.5, dBeta: 0 },
    ]);
    const loaded = await loadLcMastery(ID.toUpperCase());
    assert.equal(loaded.source, "memory");
    assert.deepEqual(loaded.posteriors.get("lc1"), { alpha: 2, beta: 2 });
    assert.deepEqual(loaded.posteriors.get("lc2"), { alpha: 1.5, beta: 1 });
  });

  test("rejects invalid learner ids and empty / negative deltas", async () => {
    assert.equal(isValidLearnerId("not-a-uuid"), false);
    assert.equal(await recordLcEvidence("x' or 1=1", [{ lcId: "a", dAlpha: 1, dBeta: 0 }]), "skipped");
    assert.equal(await recordLcEvidence(ID, [{ lcId: "a", dAlpha: -1, dBeta: 0 }]), "skipped");
    assert.equal(await recordLcEvidence(ID, []), "skipped");
    assert.equal((await loadLcMastery("nope")).posteriors.size, 0);
  });
});
