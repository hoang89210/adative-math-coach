import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applyDeltas,
  betaCdf,
  betaQuantile,
  buildHeatmap,
  classifyMastery,
  deltasFromObservations,
  evidenceCount,
  masteryMean,
  pickPrimaryStandard,
  poolPosteriors,
  posteriorsFromTallies,
  prior,
  summarize,
  updateBeta,
} from "./lc-mastery";

const close = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `${a} !~ ${b}`);

describe("Beta update", () => {
  test("prior is Beta(1,1); correct -> alpha+1, wrong -> beta+1", () => {
    let p = prior();
    assert.deepEqual(p, { alpha: 1, beta: 1 });
    p = updateBeta(p, true);
    p = updateBeta(p, false);
    p = updateBeta(p, true);
    assert.deepEqual(p, { alpha: 3, beta: 2 });
    assert.equal(evidenceCount(p), 3);
    close(masteryMean(p), 0.6);
  });

  test("ignores non-positive / NaN weights", () => {
    assert.deepEqual(updateBeta(prior(), true, -1), prior());
    assert.deepEqual(updateBeta(prior(), true, Number.NaN), prior());
  });
});

describe("classifyMastery thresholds", () => {
  test("no data -> insufficient", () => {
    assert.equal(classifyMastery(prior()), "insufficient");
  });
  test("one wrong (n=1) is still insufficient, not gap", () => {
    assert.equal(classifyMastery({ alpha: 1, beta: 2 }), "insufficient");
  });
  test("two wrong (n=2, mean .25) -> gap", () => {
    assert.equal(classifyMastery({ alpha: 1, beta: 3 }), "gap");
  });
  test("1 right 1 wrong (mean .5) -> learning (gap needs mean < .5)", () => {
    assert.equal(classifyMastery({ alpha: 2, beta: 2 }), "learning");
  });
  test("3 right (mean .8, n=3) -> mastered", () => {
    assert.equal(classifyMastery({ alpha: 4, beta: 1 }), "mastered");
  });
  test("2 right (n=2, mean .75) -> learning (mastered needs n >= 3)", () => {
    assert.equal(classifyMastery({ alpha: 3, beta: 1 }), "learning");
  });
  test("fractional evidence summing to 3 still counts as n >= 3", () => {
    let p = prior();
    for (let i = 0; i < 9; i++) p = updateBeta(p, true, 1 / 3);
    assert.equal(classifyMastery(p), "mastered");
  });
});

describe("betaCdf / betaQuantile", () => {
  test("uniform", () => {
    close(betaQuantile(0.2, 1, 1), 0.2);
    close(betaCdf(0.3, 1, 1), 0.3);
  });
  test("closed forms: Beta(2,1), Beta(1,2), Beta(4,1)", () => {
    close(betaQuantile(0.2, 2, 1), Math.sqrt(0.2));
    close(betaQuantile(0.2, 1, 2), 1 - Math.sqrt(0.8));
    close(betaQuantile(0.2, 4, 1), 0.2 ** 0.25);
  });
  test("symmetric median is 0.5 and quantile inverts cdf", () => {
    close(betaQuantile(0.5, 3, 3), 0.5);
    const x = betaQuantile(0.2, 7.5, 2.25);
    close(betaCdf(x, 7.5, 2.25), 0.2, 1e-7);
  });
  test("lower80 rises with more evidence at the same mean", () => {
    const small = summarize({ alpha: 5, beta: 2 }).lower80;
    const big = summarize({ alpha: 41, beta: 11 }).lower80;
    assert.ok(big > small);
  });
});

describe("observations -> deltas", () => {
  test("single-LC item gives a full unit", () => {
    assert.deepEqual(deltasFromObservations([{ lcIds: ["a"], correct: true }]), [
      { lcId: "a", dAlpha: 1, dBeta: 0 },
    ]);
  });
  test("multi-LC item splits 1/k and dedupes ids", () => {
    const d = deltasFromObservations([
      { lcIds: ["a", "b", "a"], correct: false },
      { lcIds: ["a"], correct: true },
      { lcIds: [], correct: true },
    ]);
    assert.deepEqual(d, [
      { lcId: "a", dAlpha: 1, dBeta: 0.5 },
      { lcId: "b", dAlpha: 0, dBeta: 0.5 },
    ]);
  });
  test("applyDeltas starts from prior and does not mutate input", () => {
    const cur = new Map([["a", { alpha: 2, beta: 1 }]]);
    const next = applyDeltas(cur, [
      { lcId: "a", dAlpha: 1, dBeta: 0 },
      { lcId: "b", dAlpha: 0, dBeta: 2 },
    ]);
    assert.deepEqual(cur.get("a"), { alpha: 2, beta: 1 });
    assert.deepEqual(next.get("a"), { alpha: 3, beta: 1 });
    assert.deepEqual(next.get("b"), { alpha: 1, beta: 3 });
  });
  test("posteriorsFromTallies clamps bad counts", () => {
    const m = posteriorsFromTallies([
      { componentId: "x", correct: 1, total: 2 },
      { componentId: "y", correct: 5, total: 2 },
    ]);
    assert.deepEqual(m.get("x"), { alpha: 2, beta: 2 });
    assert.deepEqual(m.get("y"), { alpha: 3, beta: 1 });
  });
});

describe("pooling + heatmap", () => {
  test("poolPosteriors sums evidence over one prior", () => {
    assert.deepEqual(poolPosteriors([{ alpha: 3, beta: 1 }, { alpha: 1, beta: 2 }, prior()]), {
      alpha: 3,
      beta: 2,
    });
    assert.deepEqual(poolPosteriors([]), prior());
  });

  test("pickPrimaryStandard prefers Multi-State (CCSS), then jurisdiction", () => {
    const stds = [
      { id: "1", code: null, description: "x", jurisdiction: "Ohio" },
      { id: "2", code: "4.NF.1", description: "x", jurisdiction: "Multi-State" },
      { id: "3", code: "4.NF.A.1", description: "x", jurisdiction: "Texas" },
    ];
    assert.equal(pickPrimaryStandard(stds, "Texas")?.id, "2");
    assert.equal(pickPrimaryStandard(stds, "Ohio")?.id, "2");
    assert.equal(pickPrimaryStandard([stds[0], stds[2]], "Texas")?.id, "3");
    assert.equal(pickPrimaryStandard(stds)?.id, "2");
    assert.equal(pickPrimaryStandard([]), null);
  });

  test("buildHeatmap groups LCs under their primary standard with counts", () => {
    const rows = buildHeatmap({
      posteriors: new Map([
        ["lc1", { alpha: 4, beta: 1 }],
        ["lc2", { alpha: 1, beta: 3 }],
        ["lc3", { alpha: 1, beta: 1 }],
      ]),
      lcMeta: [
        { id: "lc1", description: "A", standards: [{ id: "s1", code: "3.OA.1", description: "S1" }] },
        { id: "lc2", description: "B", standards: [{ id: "s1", code: "3.OA.1", description: "S1" }] },
      ],
    });
    assert.equal(rows.length, 2);
    const s1 = rows.find((r) => r.standardId === "s1")!;
    assert.equal(s1.cells.length, 2);
    assert.equal(s1.cells[0].lcId, "lc2"); // weakest first
    assert.equal(s1.cells[0].summary.state, "gap");
    assert.equal(s1.cells[0].summary.wrong, 2);
    assert.equal(s1.cells[1].summary.correct, 3);
    assert.equal(s1.summary.n, 5);
    const unmapped = rows.find((r) => r.standardId === "unmapped")!;
    assert.equal(unmapped.cells[0].summary.state, "insufficient");
  });
});
