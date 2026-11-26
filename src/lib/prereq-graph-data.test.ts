import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getStandardIndex } from "./data/learning-components";
import { analyzeRootGaps, getPrereqEdges, standardLabel } from "./data/prereq-graph";
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

  test("end-to-end: a gap on 4.NF.B.3.b yields an 'Ôn nền tảng' suggestion", () => {
    const target = [...idx.standards.values()].find(
      (s) => s.code === "4.NF.B.3.b" && s.jurisdiction === "Multi-State",
    )!;
    const lc = target.lcIds[0];
    const reports = analyzeRootGaps({
      posteriors: new Map([[lc, { alpha: 1, beta: 4 }]]),
      jurisdiction: "Multi-State",
    });
    assert.ok(reports.length >= 1);
    const r = reports[0];
    assert.match(r.suggestion, /^Ôn nền tảng: .+ trước khi tiếp .+$/);
    assert.ok(r.depth >= 1 && r.depth <= 3);
    assert.equal(r.root.state, "insufficient");
    assert.ok(r.diagnostics.length >= 2 && r.diagnostics.length <= 3);
  });
});
