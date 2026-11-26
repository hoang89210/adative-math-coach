import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { HttpError, errorResponse, readJsonBody } from "./api-errors";
import {
  compareRelatedStandards,
  getStandardIndex,
  unionComponents,
} from "./data/learning-components";
import type { LearningComponent, RelatedStandard } from "./data/types";
import {
  GRADE_MAX_DISTINCT_LCS,
  GRADE_MAX_LCS_PER_ITEM,
  GRADE_MAX_QUESTIONS,
  filterEvidenceLcIds,
  validateGradeBody,
} from "./grade-input";
import { pickPrimaryStandard } from "./lc-mastery";
import { isValidSessionRef } from "./mastery-codes";

/** QA round 1 on PR #4 (Nga) — one block per bug. */

const std = (id: string, code: string | null, jurisdiction: string, grades: string[]): RelatedStandard => ({
  id,
  code,
  description: code ?? id,
  gradeLevel: grades,
  jurisdiction,
});

describe("bug 1 — LC standards are the union across grade entries", () => {
  test("unionComponents merges per-grade copies and dedupes standards", () => {
    const g1: LearningComponent = { id: "lc", description: "d", relatedStandards: [std("or", "4.GM.B.6", "Oregon", ["1"])] };
    const g4: LearningComponent = {
      id: "lc",
      description: "d",
      relatedStandards: [std("or", "4.GM.B.6", "Oregon", ["1"]), std("ms", "4.MD.A.3", "Multi-State", ["4"])],
    };
    const u = unionComponents({ "1": [g1], "4": [g4] }).get("lc")!;
    assert.equal(u.relatedStandards.length, 2);
    assert.equal(u.relatedStandards[0].jurisdiction, "Multi-State"); // deterministic order
    assert.equal(pickPrimaryStandard(u.relatedStandards, "Multi-State", "4")?.code, "4.MD.A.3");
  });

  test("real data: LC 1a91a235… has its grade-4 CCSS standard 4.MD.A.3 as primary", () => {
    const c = [...getStandardIndex().components.values()].find((x) => x.id.startsWith("1a91a235"));
    assert.ok(c);
    assert.ok(c!.relatedStandards.length >= 48);
    assert.ok(c!.relatedStandards.some((s) => s.code === "4.MD.A.3"));
    assert.equal(pickPrimaryStandard(c!.relatedStandards, "Multi-State", "4")?.code, "4.MD.A.3");
    assert.equal(pickPrimaryStandard(c!.relatedStandards, "Oregon", "4")?.jurisdiction, "Multi-State");
  });

  test("real data: no LC with a CCSS standard gets a state standard as primary", () => {
    let wrong = 0;
    for (const c of getStandardIndex().components.values()) {
      const hasMs = c.relatedStandards.some((s) => s.jurisdiction === "Multi-State" && s.code);
      if (hasMs && pickPrimaryStandard(c.relatedStandards, "Multi-State", "4")?.jurisdiction !== "Multi-State") wrong++;
    }
    assert.equal(wrong, 0);
  });

  test("pickPrimaryStandard is order-independent and prefers the learner grade", () => {
    const list = [
      std("a", "1.OA.A.1", "Multi-State", ["1"]),
      std("b", "4.OA.A.1", "Multi-State", ["4"]),
      std("c", "4.GM.A.1", "Oregon", ["4"]),
      std("d", null, "Multi-State", ["4"]),
    ];
    for (const order of [list, [...list].reverse(), [list[2], list[0], list[3], list[1]]]) {
      assert.equal(pickPrimaryStandard(order, "Oregon", "4")?.id, "b");
      assert.equal(pickPrimaryStandard(order, undefined, undefined)?.id, "a");
    }
    assert.equal(pickPrimaryStandard([list[2], list[3]], "Oregon", "4")?.id, "c");
    assert.ok(compareRelatedStandards(list[1], list[2]) < 0);
  });
});

describe("bug 2 — grade input caps + LC validation", () => {
  const q = (i: number, extra?: unknown) => ({
    id: `q${i}`,
    question: "x",
    type: "short_answer",
    correct_answer: "1",
    target_component_id: `lc${i}`,
    ...(extra !== undefined ? { target_component_ids: extra } : {}),
  });

  test("rejects too many questions / ids per item / bad learnerId", () => {
    const many = Array.from({ length: GRADE_MAX_QUESTIONS + 1 }, (_, i) => q(i));
    assert.throws(() => validateGradeBody({ grade: "4", questions: many }), (e: unknown) => e instanceof HttpError && e.status === 400);
    const ids = Array.from({ length: 2500 }, (_, i) => `fake${i}`);
    assert.throws(() => validateGradeBody({ grade: "4", questions: [q(0, ids)] }), /too many learning components/);
    assert.throws(() => validateGradeBody({ grade: "4", questions: [q(0)], learnerId: "nope" }), /invalid learnerId/);
    assert.throws(() => validateGradeBody({ grade: "4", questions: [q(0, "x")] }), /must be an array/);
    assert.throws(() => validateGradeBody({ grade: "<script>", questions: [q(0)] }), /grade and questions/);
  });

  test("accepts a normal diagnostic and dedupes ids", () => {
    const v = validateGradeBody({
      grade: "4",
      learnerId: "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
      questions: [q(0, ["lc0", "lcX", "lcX"])],
      answers: [{ questionId: "q0", answer: "1" }],
    });
    assert.deepEqual(v.questions[0].target_component_ids, ["lcX"]);
    assert.ok(GRADE_MAX_LCS_PER_ITEM >= 2);
  });

  test("filterEvidenceLcIds drops unknown LCs and caps distinct LCs per attempt", () => {
    const known = (id: string) => id.startsWith("ok");
    const obs = Array.from({ length: 30 }, (_, i) => ({ lcIds: [`ok${i}`, `fake${i}`], correct: true }));
    const r = filterEvidenceLcIds(obs, known);
    const distinct = new Set(r.observations.flatMap((o) => o.lcIds));
    assert.equal(distinct.size, GRADE_MAX_DISTINCT_LCS);
    assert.ok([...distinct].every(known));
    assert.equal(r.dropped, 30 + (30 - GRADE_MAX_DISTINCT_LCS));
  });
});

describe("bug 5 — malformed / oversized JSON is a generic 4xx", () => {
  const req = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://x/api", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

  test("malformed JSON -> 400 'Invalid JSON body' (no parser text)", async () => {
    await assert.rejects(readJsonBody(req("{bad")), (e: unknown) => e instanceof HttpError && e.status === 400 && e.message === "Invalid JSON body");
    const res = errorResponse(new SyntaxError("Unexpected token b in JSON at position 1"));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid JSON body" });
  });
  test("non-object JSON -> 400; oversized -> 413", async () => {
    await assert.rejects(readJsonBody(req("[1,2]")), (e: unknown) => e instanceof HttpError && e.status === 400);
    await assert.rejects(readJsonBody(req("x".repeat(2000)), 1000), (e: unknown) => e instanceof HttpError && e.status === 413);
    await assert.rejects(readJsonBody(req("{}", { "content-length": "999999" }), 1000), (e: unknown) => e instanceof HttpError && e.status === 413);
    assert.deepEqual(await readJsonBody(req('{"a":1}')), { a: 1 });
  });
});

describe("bug 3/4 — DB unavailable maps to 503 + Retry-After", () => {
  test("errorResponse: DB timeout / refused -> 503 with Retry-After, no raw text", async () => {
    for (const err of [
      new Error("database temporarily unavailable"),
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" }),
      new Error("timeout exceeded when trying to connect"),
    ]) {
      const res = errorResponse(err);
      assert.equal(res.status, 503);
      assert.ok(Number(res.headers.get("Retry-After")) >= 1);
      assert.doesNotMatch(JSON.stringify(await res.json()), /127\.0\.0\.1|ECONNREFUSED/);
    }
  });
  test("other errors stay 500 and are sanitized", async () => {
    const res = errorResponse(new Error("boom postgres://u:p@h/db"));
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(await res.json()), /u:p@/);
  });
});

describe("minor — session code format is validated before any DB query", () => {
  test("isValidSessionRef", () => {
    assert.equal(isValidSessionRef("ZZZZZZZZ"), false);
    assert.equal(isValidSessionRef("abc"), false);
    assert.equal(isValidSessionRef("'; drop table x; --"), false);
    assert.equal(isValidSessionRef("3F2B8A4E"), true);
    assert.equal(isValidSessionRef("3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b"), true);
    assert.equal(isValidSessionRef("3f2b8a4e1c2d4e5f8a9b0c1d2e3f4a5b"), true);
  });
});
