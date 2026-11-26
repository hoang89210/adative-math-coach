import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type NodeStatus,
  type PrereqEdge,
  diagnoseSuggestion,
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

const G = (state: NodeStatus["state"], mean: number, n: number, grade: number): NodeStatus => ({
  state,
  mean,
  n,
  grade,
});

function review(r: ReturnType<typeof findRootGap>) {
  assert.ok(r && r.kind === "review", `expected review, got ${JSON.stringify(r)}`);
  return r;
}
function diagnose(r: ReturnType<typeof findRootGap>) {
  assert.ok(r && r.kind === "diagnose", `expected diagnose, got ${JSON.stringify(r)}`);
  return r;
}

describe("findRootGap (nearest gap-with-data policy)", () => {
  test("picks the NEAREST prerequisite that has data and is in gap (not the deepest)", () => {
    const status: Record<string, NodeStatus> = {
      A: S("gap", 0.3, 3),
      B: S("gap", 0.1, 4),
    };
    const r = review(
      findRootGap({
        targetId: "T",
        getPrereqs: graph({ T: ["A"], A: ["B"] }),
        statusOf: (id) => status[id] ?? S("insufficient"),
      }),
    );
    assert.equal(r.rootId, "A");
    assert.equal(r.depth, 1);
    assert.deepEqual(r.path, ["T", "A"]);
    assert.equal(r.dataSource, "real");
  });

  test("walks through a learning prerequisite (with data) to a deeper gap", () => {
    const r = review(
      findRootGap({
        targetId: "T",
        getPrereqs: graph({ T: ["A"], A: ["B"], B: ["C"] }),
        statusOf: (id) =>
          ({ A: S("learning", 0.6, 3), B: S("gap", 0.2, 3), C: S("gap", 0.0, 2) })[id] ?? S("insufficient"),
      }),
    );
    assert.equal(r.rootId, "B");
    assert.equal(r.depth, 2);
    assert.deepEqual(r.pathSources, ["buildsTowards", "buildsTowards"]);
  });

  test("no-data nodes are leaves: never walk through them, never suggest review of them", () => {
    // A has no data; its prerequisite B is a gap but must NOT be reached through A
    const r = diagnose(
      findRootGap({
        targetId: "T",
        getPrereqs: graph({ T: ["A"], A: ["B"] }),
        statusOf: (id) => (id === "B" ? S("gap", 0.1, 3) : S("insufficient")),
      }),
    );
    assert.deepEqual(r.prereqs.map((e) => e.id), ["A"]);
  });

  test("diagnose lists only DIRECT no-data prerequisites (max 3, real edges first)", () => {
    const r = diagnose(
      findRootGap({
        targetId: "T",
        getPrereqs: graph({
          T: [{ id: "h", source: "heuristic" }, "d", "c", "b", "M"],
          M: ["deep"],
        }),
        statusOf: (id) => (id === "M" ? S("mastered", 0.9, 5) : S("insufficient")),
      }),
    );
    assert.deepEqual(r.prereqs.map((e) => e.id), ["b", "c", "d"]);
    assert.equal(r.dataSource, "real");
  });

  test("learning prerequisite whose own prerequisites have no data -> diagnose only the DIRECT no-data ones, else null", () => {
    assert.equal(
      findRootGap({
        targetId: "T",
        getPrereqs: graph({ T: ["A"], A: ["X"] }),
        statusOf: (id) => (id === "A" ? S("learning", 0.6, 3) : S("insufficient")),
      }),
      null,
    );
  });

  test("ties at the same depth: lower mean, then id; gap requires data", () => {
    const r = review(
      findRootGap({
        targetId: "T",
        getPrereqs: graph({ T: ["a", "b", "c", "d"] }),
        statusOf: (id) =>
          ({ a: S("insufficient"), b: S("learning", 0.6, 2), c: S("gap", 0.3, 2), d: S("gap", 0.2, 3) })[id]!,
      }),
    );
    assert.equal(r.rootId, "d");
  });

  test("prefers real edges over heuristic; heuristic at most 1 hop per path", () => {
    // heuristic A -> heuristic B would be 2 heuristic hops: B is not reachable
    const r1 = findRootGap({
      targetId: "T",
      getPrereqs: graph({
        T: [{ id: "A", source: "heuristic" }],
        A: [{ id: "B", source: "heuristic" }],
      }),
      statusOf: (id) => (id === "A" ? S("learning", 0.6, 3) : S("gap", 0.0, 4)),
    });
    assert.equal(r1, null);

    // one heuristic hop then a real edge is fine and is labelled heuristic
    const r2 = review(
      findRootGap({
        targetId: "T",
        getPrereqs: graph({ T: [{ id: "A", source: "heuristic" }], A: ["T", "B"], B: ["A"] }),
        statusOf: (id) => (id === "B" ? S("gap", 0.2, 3) : S("learning", 0.6, 2)),
      }),
    );
    assert.equal(r2.rootId, "B");
    assert.deepEqual(r2.pathSources, ["heuristic", "buildsTowards"]);
    assert.equal(r2.dataSource, "heuristic");

    // same-depth tie: real edge wins over heuristic edge with equal mean
    const r3 = review(
      findRootGap({
        targetId: "T",
        getPrereqs: graph({ T: [{ id: "a", source: "heuristic" }, { id: "z", source: "buildsTowards" }] }),
        statusOf: () => S("gap", 0.2, 3),
      }),
    );
    assert.equal(r3.rootId, "z"); // equal mean -> real edge preferred over heuristic
    assert.equal(r3.dataSource, "real");
  });

  test("never more than 2 grades below the target standard", () => {
    const status: Record<string, NodeStatus> = {
      T: G("gap", 0.2, 3, 5),
      g4: G("learning", 0.6, 3, 4),
      g3: G("learning", 0.6, 3, 3),
      g2: G("gap", 0.0, 4, 2), // 3 grades below grade 5 -> excluded
    };
    assert.equal(
      findRootGap({
        targetId: "T",
        getPrereqs: graph({ T: ["g4"], g4: ["g3"], g3: ["g2"] }),
        statusOf: (id) => status[id] ?? S("insufficient"),
      }),
      null,
    );
    status.g3 = G("gap", 0.1, 3, 3); // exactly 2 below -> allowed
    assert.equal(
      review(
        findRootGap({
          targetId: "T",
          getPrereqs: graph({ T: ["g4"], g4: ["g3"], g3: ["g2"] }),
          statusOf: (id) => status[id] ?? S("insufficient"),
        }),
      ).rootId,
      "g3",
    );
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

  test("maxDepth is respected and cycles terminate", () => {
    const r = review(
      findRootGap({
        targetId: "T",
        maxDepth: 1,
        getPrereqs: graph({ T: ["A"], A: ["B"] }),
        statusOf: () => S("gap", 0.1, 3),
      }),
    );
    assert.equal(r.rootId, "A");
    assert.equal(
      findRootGap({
        targetId: "T",
        getPrereqs: graph({ T: ["A"], A: ["T", "B"], B: ["A"] }),
        statusOf: () => S("learning", 0.6, 3),
      }),
      null,
    );
  });
});

describe("suggestion + diagnostics", () => {
  test("Vietnamese foundation sentence", () => {
    assert.equal(foundationSuggestion("3.NF.A.1", "4.NF.B.3"), "Ôn nền tảng: 3.NF.A.1 trước khi tiếp 4.NF.B.3");
  });
  test("diagnose sentence never says Ôn", () => {
    const s = diagnoseSuggestion(["3.NF.A.1", "3.NF.A.2"], "4.NF.B.3");
    assert.equal(s, "Kiểm tra nhanh nền tảng: 3.NF.A.1, 3.NF.A.2 trước khi tiếp 4.NF.B.3");
    assert.ok(!s.includes("Ôn"));
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
