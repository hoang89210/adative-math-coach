import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getStandardIndex } from "./data/learning-components";
import {
  analyzeRootGaps,
  getPrereqEdges,
  lcStandardsWithAlignment,
  standardLabel,
  standardStatus,
} from "./data/prereq-graph";
import { pickPrimaryStandard } from "./lc-mastery";
import { buildLcMasteryReport } from "./lc-mastery-report";
import { loadProgression } from "./data/progression";

/**
 * Integration checks against the committed data/ indexes. These guard the
 * id-space fix: progression edges must point at math-index standard ids.
 */
describe("prerequisite graph over data/ (Learning Commons KG)", () => {
  const prog = loadProgression();
  const idx = getStandardIndex();

  test("progression index v2 resolves to math-index standard ids", () => {
    assert.ok(prog, "progression-index.json present");
    assert.equal(prog!.version, 2);
    assert.equal(prog!.edgeCount, 757);
    const ids = new Set([...Object.keys(prog!.buildsTowards), ...Object.keys(prog!.prerequisitesOf)]);
    let hit = 0;
    for (const id of ids) if (idx.standards.has(id)) hit += 1;
    assert.equal(hit, ids.size, "every progression endpoint is a math-index standard");
  });

  test("CCSS standard gets real buildsTowards prerequisites", () => {
    const target = [...idx.standards.values()].find(
      (s) => s.code === "4.NF.B.3.b" && s.jurisdiction === "Multi-State",
    );
    assert.ok(target, "4.NF.B.3 in math-index");
    const edges = getPrereqEdges(target!.id);
    assert.ok(edges.length > 0);
    assert.ok(edges.every((e) => e.source === "buildsTowards"));
    assert.ok(edges.map((e) => standardLabel(e.id)).some((c) => c.startsWith("3.NF") || c.startsWith("4.NF")));
  });

  test("state standard reaches CCSS prerequisites via hasStandardAlignment", () => {
    const aligned = Object.keys(prog!.alignedToCcss ?? {}).find(
      (id) => !prog!.prerequisitesOf[id] && idx.standards.get(id)?.jurisdiction !== "Multi-State",
    );
    assert.ok(aligned);
    const edges = getPrereqEdges(aligned!);
    if (edges.length) assert.ok(edges.every((e) => e.source === "alignment"));
  });

  test("end-to-end: a gap on 4.NF.B.3.b with no data on prerequisites -> diagnose (no 'Ôn')", () => {
    const target = [...idx.standards.values()].find(
      (s) => s.code === "4.NF.B.3.b" && s.jurisdiction === "Multi-State",
    )!;
    const lc = target.lcIds[0];
    const reports = analyzeRootGaps({
      posteriors: new Map([[lc, { alpha: 1, beta: 4 }]]),
      jurisdiction: "Multi-State",
      grade: "4",
    });
    assert.ok(reports.length >= 1);
    const r = reports[0];
    assert.equal(r.kind, "diagnose");
    assert.equal(r.root, null);
    assert.match(r.suggestion, /^Kiểm tra nhanh nền tảng: .+ trước khi tiếp .+$/);
    assert.ok(!r.suggestion.includes("Ôn"));
    assert.ok(r.checkPrereqs.length >= 1 && r.checkPrereqs.length <= 3);
    assert.ok(r.checkPrereqs.every((c) => c.source !== "heuristic"));
    assert.ok(r.diagnostics.length >= 2 && r.diagnostics.length <= 3);
  });

  test("end-to-end: gap on a DIRECT prerequisite with data -> review of that nearest prerequisite", () => {
    const target = [...idx.standards.values()].find(
      (s) => s.code === "4.NF.B.3.b" && s.jurisdiction === "Multi-State",
    )!;
    const empty = new Map();
    const direct = getPrereqEdges(target.id).find(
      (e) => e.source === "buildsTowards" && (standardStatus(e.id, empty).grade ?? 0) >= 2,
    )!;
    const prereqLc = idx.standards.get(direct.id)!.lcIds[0];
    const reports = analyzeRootGaps({
      posteriors: new Map([
        [target.lcIds[0], { alpha: 1, beta: 4 }],
        [prereqLc, { alpha: 1, beta: 3 }],
      ]),
      jurisdiction: "Multi-State",
      grade: "4",
    });
    const r = reports.find((x) => x.target.standardId === target.id)!;
    assert.equal(r.kind, "review");
    assert.equal(r.depth, 1);
    assert.equal(r.root!.standardId, direct.id);
    assert.equal(r.dataSource, "real");
    assert.match(r.suggestion, /^Ôn nền tảng: .+ trước khi tiếp 4\.NF\.B\.3\.b$/);
  });

  test("grade floor on real data: a grade-1 prerequisite gap is never suggested for a grade-4 standard", () => {
    const target = [...idx.standards.values()].find(
      (s) => s.code === "4.NF.B.3.b" && s.jurisdiction === "Multi-State",
    )!;
    const empty = new Map();
    const low = getPrereqEdges(target.id).find((e) => standardStatus(e.id, empty).grade === 1);
    assert.ok(low, "4.NF.B.3.b has a grade-1 prerequisite in the KG (1.OA.B.x)");
    const reports = analyzeRootGaps({
      posteriors: new Map([
        [target.lcIds[0], { alpha: 1, beta: 4 }],
        [idx.standards.get(low!.id)!.lcIds[0], { alpha: 1, beta: 3 }],
      ]),
      jurisdiction: "Multi-State",
      grade: "4",
    });
    const r = reports.find((x) => x.target.standardId === target.id)!;
    assert.notEqual(r.root?.standardId, low!.id);
    assert.ok(r.checkPrereqs.every((c) => c.standardId !== low!.id));
  });

  test("Multi-State learner never sees another state's codes (QA preview learner, 13 LCs)", () => {
    // alpha/beta from /workspace/amc-pr4-qa-evidence/preview-mastery-api.json
    const expected: Record<string, [number, number]> = {
      "984b8dc3-b5db-551f-9af5-b44b06aaa40c": [2, 1],
      "144856f4-26da-5abc-af5f-02f1f71d0bed": [2, 1],
      "27812e5c-a04d-549c-8341-4ab7bccdb688": [2, 2],
      "ec7e77d8-d9f7-5765-8104-d5f38d064aa8": [1, 2],
      "f548ce1a-ef91-5a91-9d5e-1cebf7fd201c": [1, 2],
      "8dc1a96f-e651-5962-b7ab-d5e811e99b81": [1, 2],
      "f44fbaad-f4a6-543f-b5d1-280862baa2c3": [1, 2],
      "2f646a05-2fae-5a36-962a-94bc9453ad83": [2, 1],
      "81f35b63-e3d7-5fef-92ef-ac579b749b04": [2, 1],
      "92e853a7-1f4a-57df-af59-5303d1ce5f1f": [1, 2],
      "32a33b2c-cdd1-58a7-a6f9-ce0b7c066d50": [1, 2],
      "6c81abb2-bfff-534b-bbe6-2c2a2a405462": [1, 2],
      "8a82f241-5bc1-5ba7-9a24-ed9c72a581d2": [1, 2],
    };
    const posteriors = new Map(
      Object.entries(expected).map(([id, [alpha, beta]]) => [id, { alpha, beta }]),
    );
    for (const jur of [undefined, "Multi-State"]) {
      const report = buildLcMasteryReport(posteriors, jur, "4");
      assert.equal(report.lcCount, 13);
      for (const row of report.heatmap) {
        if (row.standardId.startsWith("unmapped")) continue;
        assert.equal(idx.standards.get(row.standardId)?.jurisdiction, "Multi-State", row.code ?? row.standardId);
        assert.ok(!/\.GM\./.test(row.code ?? ""), `state code leaked: ${row.code}`);
      }
      for (const r of report.rootGaps) {
        assert.equal(idx.standards.get(r.target.standardId)?.jurisdiction, "Multi-State");
        assert.ok(!/\.GM\./.test(r.target.label + (r.root?.label ?? "")), r.suggestion);
      }
    }
  });

  test("every math LC maps to a CCSS primary (own or aligned) or the unmapped group for Multi-State", () => {
    let mapped = 0;
    let unmapped = 0;
    for (const comp of idx.components.values()) {
      const p = pickPrimaryStandard(lcStandardsWithAlignment(comp), "Multi-State", "4");
      if (p) {
        assert.equal(p.jurisdiction ?? "Multi-State", "Multi-State");
        mapped++;
      } else unmapped++;
    }
    assert.ok(mapped > 0);
    assert.ok(mapped > unmapped, `mapped ${mapped} unmapped ${unmapped}`);
  });

  test("a state learner may see their own state's code when the LC has no CCSS standard", () => {
    const comp = [...idx.components.values()].find(
      (c) =>
        c.relatedStandards.length > 0 &&
        c.relatedStandards.every((s) => s.jurisdiction && s.jurisdiction !== "Multi-State" && s.code) &&
        lcStandardsWithAlignment(c).every((s) => s.jurisdiction !== "Multi-State"),
    );
    if (!comp) return; // data has none — nothing to check
    const jur = comp.relatedStandards[0].jurisdiction!;
    assert.equal(pickPrimaryStandard(lcStandardsWithAlignment(comp), jur, "4")?.jurisdiction, jur);
    assert.equal(pickPrimaryStandard(lcStandardsWithAlignment(comp), "Multi-State", "4"), null);
  });
});
