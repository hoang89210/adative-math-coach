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

before(async () => {
  NextRequest = (await import("next/server")).NextRequest;
  grade = await import("../app/api/diagnostic/grade/route");
  learners = await import("../app/api/learners/route");
  store = await import("./lc-mastery-store");
  const { getStandardIndex } = await import("./data/learning-components");
  realLc = getStandardIndex().components.keys().next().value as string;
});

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

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
  test("random (nonexistent) learner UUID -> 404, nothing recorded", async () => {
    const ghost = "0b9a4c1e-7d3f-4a2b-9c8d-112233445566";
    const res = await grade.POST(
      post("/api/diagnostic/grade", {
        grade: "4",
        learnerId: ghost,
        questions: [q("q0", realLc)],
        answers: [{ questionId: "q0", answer: "5" }],
      }),
    );
    assert.equal(res.status, 404);
    assert.equal((await store.loadLcMastery(ghost)).posteriors.size, 0);
  });

  test("existing learner: unknown LC ids are dropped, only real LCs get evidence", async () => {
    const created = await learners.POST(post("/api/learners", { action: "create", pin: "1234", grade: "4" }));
    assert.equal(created.status, 200);
    const { learnerId } = (await created.json()) as { learnerId: string };
    const res = await grade.POST(
      post("/api/diagnostic/grade", {
        grade: "4",
        learnerId,
        questions: [q("q0", realLc, ["fake-a", "fake-b"]), q("q1", "fake-c")],
        answers: [
          { questionId: "q0", answer: "5" },
          { questionId: "q1", answer: "5" },
        ],
      }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { lcMasteryStore: string; lcIdsDropped: number };
    assert.equal(body.lcMasteryStore, "memory");
    assert.equal(body.lcIdsDropped, 3);
    const loaded = await store.loadLcMastery(learnerId);
    assert.deepEqual([...loaded.posteriors.keys()], [realLc]);
  });
});
