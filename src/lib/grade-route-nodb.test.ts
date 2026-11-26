import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { NextRequest as NextRequestT } from "next/server";

/**
 * QA bug 2 regression without a database (local-fs + in-memory stores).
 * Own process, so clearing DB env here does not affect other files.
 */
for (const v of ["POSTGRES_PRISMA_URL", "POSTGRES_URL", "DATABASE_URL", "POSTGRES_URL_NON_POOLING", "BLOB_READ_WRITE_TOKEN"]) {
  delete process.env[v];
}

type Handler = (req: NextRequestT) => Promise<Response>;
let NextRequest: typeof NextRequestT;
let grade: { POST: Handler };
let learners: { POST: Handler };
let store: typeof import("./lc-mastery-store");
let realLc: string;
let tokens: typeof import("./learner-token");
let masteryRoute: { POST: Handler };

before(async () => {
  NextRequest = (await import("next/server")).NextRequest;
  grade = await import("../app/api/diagnostic/grade/route");
  learners = await import("../app/api/learners/route");
  store = await import("./lc-mastery-store");
  tokens = await import("./learner-token");
  masteryRoute = await import("../app/api/mastery/route");
  const { getStandardIndex } = await import("./data/learning-components");
  realLc = getStandardIndex().components.keys().next().value as string;
});

let ipSeq = 0;
const post = (url: string, body: unknown, ip = `198.51.100.${++ipSeq}`) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-real-ip": ip },
  });

async function createLearner() {
  const created = await learners.POST(post("/api/learners", { action: "create", pin: "1234", grade: "4" }));
  assert.equal(created.status, 200);
  return (await created.json()) as { learnerId: string; learnerToken: string };
}

const q = (id: string, lc: string, extra?: string[]) => ({
  id,
  question: "2+3?",
  type: "short_answer",
  correct_answer: "5",
  target_component_id: lc,
  ...(extra ? { target_component_ids: extra } : {}),
  explanation: "",
});

describe("grade route — learner binding and LC validation (no DB)", () => {
  test("random learner UUID without a token -> graded but NOT linked, nothing recorded", async () => {
    const ghost = "0b9a4c1e-7d3f-4a2b-9c8d-112233445566";
    const res = await grade.POST(
      post("/api/diagnostic/grade", {
        grade: "4",
        learnerId: ghost,
        questions: [q("q0", realLc)],
        answers: [{ questionId: "q0", answer: "5" }],
      }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { learnerLinked: boolean; learnerLinkIssue: string; lcMasteryStore: string };
    assert.equal(body.learnerLinked, false);
    assert.equal(body.learnerLinkIssue, "missing");
    assert.equal(body.lcMasteryStore, "skipped");
    assert.equal((await store.loadLcMastery(ghost)).posteriors.size, 0);
  });

  test("random learner UUID with a validly signed token -> 404 (learner must exist)", async () => {
    const ghost = "0b9a4c1e-7d3f-4a2b-9c8d-112233445567";
    const res = await grade.POST(
      post("/api/diagnostic/grade", {
        grade: "4",
        learnerId: ghost,
        learnerToken: tokens.issueLearnerToken(ghost),
        questions: [q("q0", realLc)],
        answers: [{ questionId: "q0", answer: "5" }],
      }),
    );
    assert.equal(res.status, 404);
    assert.equal((await store.loadLcMastery(ghost)).posteriors.size, 0);
  });

  test("ownership: learner A's token cannot write evidence for learner B; forged/expired tokens rejected", async () => {
    const a = await createLearner();
    const b = await createLearner();
    for (const [learnerToken, issue] of [
      [a.learnerToken, "mismatch"],
      ["v1.9999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "mismatch"],
      ["v1.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "expired"],
      ["not-a-token", "malformed"],
    ] as const) {
      const res = await grade.POST(
        post("/api/diagnostic/grade", {
          grade: "4",
          learnerId: b.learnerId,
          learnerToken,
          questions: [q("q0", realLc)],
          answers: [{ questionId: "q0", answer: "5" }],
        }),
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { learnerLinked: boolean; learnerLinkIssue?: string };
      assert.equal(body.learnerLinked, false);
      assert.equal(body.learnerLinkIssue, issue);
    }
    assert.equal((await store.loadLcMastery(b.learnerId)).posteriors.size, 0);
  });

  test("create and PIN login both issue a token that verifies for that learner", async () => {
    const created = await learners.POST(post("/api/learners", { action: "create", pin: "4321", grade: "4" }));
    const c = (await created.json()) as { learnerId: string; publicCode: string; learnerToken: string };
    const login = await learners.POST(post("/api/learners", { action: "login", code: c.publicCode, pin: "4321" }));
    assert.equal(login.status, 200);
    const l = (await login.json()) as { learnerId: string; learnerToken: string };
    assert.equal(l.learnerId, c.learnerId);
    assert.match(l.learnerToken, /^v1\.\d+\.[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(tokens.verifyLearnerToken(l.learnerId, l.learnerToken), { ok: true });
  });

  test("rate limit: per-learner evidence writes capped (429 + Retry-After), other learners unaffected", async () => {
    const a = await createLearner();
    const limit = grade.GRADE_RATE_LIMIT_PER_LEARNER as number;
    const body = {
      grade: "4",
      learnerId: a.learnerId,
      learnerToken: a.learnerToken,
      questions: [q("q0", realLc)],
      answers: [{ questionId: "q0", answer: "5" }],
    };
    for (let i = 0; i < limit; i++) {
      const res = await grade.POST(post("/api/diagnostic/grade", body));
      assert.equal(res.status, 200, `request ${i + 1}`);
    }
    const blocked = await grade.POST(post("/api/diagnostic/grade", body));
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    const p = (await store.loadLcMastery(a.learnerId)).posteriors.get(realLc)!;
    assert.equal(p.alpha, 1 + limit, "blocked request wrote nothing");

    const other = await createLearner();
    const ok = await grade.POST(
      post("/api/diagnostic/grade", { ...body, learnerId: other.learnerId, learnerToken: other.learnerToken }),
    );
    assert.equal(ok.status, 200);
  });

  test("rate limit: per-IP cap applies even without a learner", async () => {
    const limit = grade.GRADE_RATE_LIMIT_PER_IP as number;
    const body = { grade: "4", questions: [q("q0", realLc)], answers: [{ questionId: "q0", answer: "5" }] };
    for (let i = 0; i < limit; i++) {
      const res = await grade.POST(post("/api/diagnostic/grade", body, "203.0.113.77"));
      assert.equal(res.status, 200, `request ${i + 1}`);
    }
    const blocked = await grade.POST(post("/api/diagnostic/grade", body, "203.0.113.77"));
    assert.equal(blocked.status, 429);
    const otherIp = await grade.POST(post("/api/diagnostic/grade", body, "203.0.113.78"));
    assert.equal(otherIp.status, 200);
  });

  test("existing learner: unknown LC ids are dropped, only real LCs get evidence", async () => {
    const { learnerId, learnerToken } = await createLearner();
    const res = await grade.POST(
      post("/api/diagnostic/grade", {
        grade: "4",
        learnerId,
        learnerToken,
        questions: [q("q0", realLc, ["fake-a", "fake-b"]), q("q1", "fake-c")],
        answers: [
          { questionId: "q0", answer: "5" },
          { questionId: "q1", answer: "5" },
        ],
      }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { lcMasteryStore: string; lcIdsDropped: number; learnerLinked: boolean };
    assert.equal(body.learnerLinked, true);
    assert.equal(body.lcMasteryStore, "memory");
    assert.equal(body.lcIdsDropped, 3);
    const loaded = await store.loadLcMastery(learnerId);
    assert.deepEqual([...loaded.posteriors.keys()], [realLc]);
  });
});

describe("/api/mastery by learnerId requires the learner token", () => {
  test("no token / other learner's token -> 401; own token -> 200", async () => {
    const a = await createLearner();
    const b = await createLearner();
    const none = await masteryRoute.POST(post("/api/mastery", { learnerId: a.learnerId }));
    assert.equal(none.status, 401);
    const wrong = await masteryRoute.POST(
      post("/api/mastery", { learnerId: a.learnerId, learnerToken: b.learnerToken }),
    );
    assert.equal(wrong.status, 401);
    const ok = await masteryRoute.POST(
      post("/api/mastery", { learnerId: a.learnerId, learnerToken: a.learnerToken }),
    );
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { mode: string };
    assert.equal(body.mode, "learner");
  });
});
