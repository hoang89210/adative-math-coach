import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type NodeStatus,
  type PrereqEdge,
  diagnosticProbes,
  findRootGap,
  foundationSuggestion,
  heuristicPrereqs,
  parseStandardCode,
  previousGrade,
} from "./root-gap";

const S = (state: NodeStatus["state"], mean = 0.5, n = 0): NodeStatus => ({ state, mean, n });

function graph(edges: Record<string, Array<string | PrereqEdge>>) {
  return (id: string): PrereqEdge[] =>
    (edges[id] ?? []).map((e) => (typeof e === "string" ? { id: e, source: "buildsTowards" as const } : e));
}

describe("findRootGap", () => {
  test("picks the deepest non-mastered prerequisite within 3 levels", () => {
    const status: Record<string, NodeStatus> = {
      A: S("learning", 0.6, 2),
      B: S("gap", 0.25, 2),
      C: S("insufficient"),
    };
    const r = findRootGap({
      targetId: "T",
      getPrereqs: graph({ T: ["A"], A: ["B"], B: ["C"], C: ["D"] }),
      statusOf: (id) => status[id] ?? S("insufficient"),
    })!;
    assert.equal(r.rootId, "C"); // depth 3; D at depth 4 is out of range
    assert.equal(r.depth, 3);
    assert.deepEqual(r.path, ["T", "A", "B", "C"]);
    assert.equal(r.needsDiagnostic, true);
    assert.equal(r.dataSource, "real");
  });

  test("does not expand mastered prerequisites", () => {
    const r = findRootGap({
      targetId: "T",
      getPrereqs: graph({ T: ["M", "G"], M: ["X"], G: [] }),
      statusOf: (id) => (id === "M" ? S("mastered", 0.9, 5) : id === "G" ? S("gap", 0.2, 3) : S("insufficient")),
    })!;
    assert.equal(r.rootId, "G");
    assert.equal(r.depth, 1);
    assert.equal(r.needsDiagnostic, false);
  });

  test("ties at the same depth prefer gap > learning > insufficient, then lower mean", () => {
    const r = findRootGap({
      targetId: "T",
      getPrereqs: graph({ T: ["a", "b", "c", "d"] }),
      statusOf: (id) =>
        ({ a: S("insufficient"), b: S("learning", 0.6, 2), c: S("gap", 0.3, 2), d: S("gap", 0.2, 3) })[id]!,
    })!;
    assert.equal(r.rootId, "d");
  });

  test("returns null when every prerequisite is mastered or none exist", () => {
    assert.equal(
      findRootGap({ targetId: "T", getPrereqs: graph({}), statusOf: () => S("insufficient") }),
      null,
    );
    assert.equal(
      findRootGap({
        targetId: "T",
        getPrereqs: graph({ T: ["A"] }),
        statusOf: () => S("mastered", 0.9, 4),
      }),
      null,
    );
  });

  test("handles cycles and marks heuristic hops", () => {
    const r = findRootGap({
      targetId: "T",
      getPrereqs: graph({ T: [{ id: "A", source: "heuristic" }], A: ["T", "B"], B: ["A"] }),
      statusOf: () => S("learning", 0.6, 2),
    })!;
    assert.equal(r.rootId, "B");
    assert.deepEqual(r.pathSources, ["heuristic", "buildsTowards"]);
    assert.equal(r.dataSource, "heuristic");
  });

  test("maxDepth is respected", () => {
    const r = findRootGap({
      targetId: "T",
      maxDepth: 1,
      getPrereqs: graph({ T: ["A"], A: ["B"] }),
      statusOf: () => S("gap", 0.1, 3),
    })!;
    assert.equal(r.rootId, "A");
  });
});

describe("suggestion + diagnostics", () => {
  test("Vietnamese foundation sentence", () => {
    assert.equal(foundationSuggestion("3.NF.A.1", "4.NF.B.3"), "Ôn nền tảng: 3.NF.A.1 trước khi tiếp 4.NF.B.3");
  });
  test("2–3 template probes, never more than 3", () => {
    const four = ["a", "b", "c", "d"].map((id) => ({ id, description: `skill ${id}` }));
    assert.equal(diagnosticProbes("X", four).length, 3);
    const one = diagnosticProbes("X", [{ id: "a", description: "skill a" }]);
    assert.equal(one.length, 2);
    assert.ok(one.every((p) => p.kind === "template" && p.prompt.includes("skill a")));
    assert.equal(diagnosticProbes("3.OA.A.1", []).length, 2);
  });
});

describe("heuristic prerequisites", () => {
  test("parseStandardCode", () => {
    assert.deepEqual(parseStandardCode("4.NF.A.1"), { grade: "4", domain: "NF", cluster: "A" });
    assert.deepEqual(parseStandardCode("K.CC.3"), { grade: "K", domain: "CC", cluster: null });
    assert.deepEqual(parseStandardCode("HSF-IF.B.4"), { grade: null, domain: "HSF-IF", cluster: "B" });
    assert.equal(parseStandardCode(null).domain, null);
  });
  test("previousGrade", () => {
    assert.equal(previousGrade("K"), null);
    assert.equal(previousGrade("1"), "K");
    assert.equal(previousGrade("5"), "4");
  });
  test("same jurisdiction + domain, one grade lower; ranked by cluster/word overlap", () => {
    const mk = (id: string, code: string, grade: string, jur: string, description: string) => ({
      id,
      code,
      description,
      grade,
      domain: parseStandardCode(code).domain,
      cluster: parseStandardCode(code).cluster,
      jurisdiction: jur,
    });
    const target = mk("t", "4.NF.A.1", "4", "Ohio", "equivalent fractions using visual fraction models");
    const pool = [
      mk("a", "3.NF.A.3", "3", "Ohio", "explain equivalence of fractions using visual models"),
      mk("b", "3.NF.B.9", "3", "Ohio", "unrelated measurement words"),
      mk("c", "3.NF.A.1", "3", "Texas", "equivalent fractions visual fraction models"),
      mk("d", "2.NF.A.1", "2", "Ohio", "equivalent fractions visual fraction models"),
      mk("e", "3.OA.A.1", "3", "Ohio", "equivalent fractions visual fraction models"),
    ];
    const edges = heuristicPrereqs(target, pool);
    assert.deepEqual(edges.map((e) => e.id), ["a", "b"]);
    assert.ok(edges.every((e) => e.source === "heuristic"));
    assert.deepEqual(heuristicPrereqs({ ...target, grade: "K" }, pool), []);
  });
});
