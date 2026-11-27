import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { NextRequest as NextRequestT } from "next/server";

/**
 * Route-level regression for QA bugs 2–5 with the DB REFUSING connections
 * (closed port). Runs in its own process (node --test isolates files), so
 * the env below does not leak into other test files.
 */
process.env.POSTGRES_URL = "postgres://amc:amc@127.0.0.1:1/amc?sslmode=disable";
process.env.DB_CONNECT_TIMEOUT_MS = "800";
process.env.DB_FAIL_BACKOFF_MS = "5000";
delete process.env.POSTGRES_PRISMA_URL;
delete process.env.DATABASE_URL;

type Handler = (req: NextRequestT) => Promise<Response>;
let NextRequest: typeof NextRequestT;
let grade: { POST: Handler };
let mastery: { POST: Handler };
let teacher: { GET: Handler };
let learners: { POST: Handler };
let issueLearnerToken: (id: string) => string;
let endPool: () => Promise<void>;

before(async () => {
  NextRequest = (await import("next/server")).NextRequest;
  grade = await import("../app/api/diagnostic/grade/route");
  mastery = await import("../app/api/mastery/route");
  teacher = await import("../app/api/teacher/session/route");
  learners = await import("../app/api/learners/route");
  issueLearnerToken = (await import("./learner-token")).issueLearnerToken;
  const db = await import("./db/client");
  endPool = () => db.getPool().end();
});

after(async () => {
  try {
    await endPool();
  } catch {
    // ignore
  }
});

const post = (url: string, body: string) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });

const question = {
  id: "q0",
  question: "2+3?",
  type: "short_answer",
  correct_answer: "5",
  target_component_id: "lc-x",
  explanation: "",
};

describe("routes with DB down (ECONNREFUSED)", () => {
  test("bug 5: grade with malformed JSON -> 400 generic", async () => {
    const res = await grade.POST(post("/api/diagnostic/grade", "{not json"));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid JSON body" });
  });

  test("bug 5: learners with malformed JSON -> 400 generic", async () => {
    const res = await learners.POST(post("/api/learners", "{"));
    assert.equal(res.status, 400);
  });

  test("bug 2: grade rejects 2500 fake LC ids per item with 400 before any write", async () => {
    const ids = Array.from({ length: 2500 }, (_, i) => `fake-${i}`);
    const res = await grade.POST(
      post(
        "/api/diagnostic/grade",
        JSON.stringify({
          grade: "4",
          learnerId: "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
          questions: [{ ...question, target_component_ids: ids }],
          answers: [{ questionId: "q0", answer: "5" }],
        }),
      ),
    );
    assert.equal(res.status, 400);
  });

  test("bug 3: grade -> 503 + Retry-After (not 500) when the session cannot be saved", async () => {
    const res = await grade.POST(
      post(
        "/api/diagnostic/grade",
        JSON.stringify({ grade: "4", questions: [question], answers: [{ questionId: "q0", answer: "5" }] }),
      ),
    );
    assert.equal(res.status, 503);
    assert.ok(Number(res.headers.get("Retry-After")) >= 1);
  });

  test("bug 2+3: grade with a learnerId while DB is down -> 503 (learner cannot be verified)", async () => {
    const res = await grade.POST(
      post(
        "/api/diagnostic/grade",
        JSON.stringify({
          grade: "4",
          learnerId: "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
          questions: [question],
          answers: [{ questionId: "q0", answer: "5" }],
        }),
      ),
    );
    assert.equal(res.status, 503);
    assert.ok(res.headers.get("Retry-After"));
  });

  test("bug 4: /api/mastery {code} -> 503 + Retry-After instead of 404", async () => {
    const res = await mastery.POST(post("/api/mastery", JSON.stringify({ code: "3F2B8A4E" })));
    assert.equal(res.status, 503);
    assert.ok(res.headers.get("Retry-After"));
  });

  test("bug 4: /api/teacher/session -> 503 + Retry-After instead of 404", async () => {
    const res = await teacher.GET(new NextRequest("http://localhost/api/teacher/session?code=3F2B8A4E"));
    assert.equal(res.status, 503);
    assert.ok(res.headers.get("Retry-After"));
  });

  test("minor: non-hex code -> 400 without DB (fast)", async () => {
    const t0 = Date.now();
    const a = await mastery.POST(post("/api/mastery", JSON.stringify({ code: "ZZZZZZZZ" })));
    const b = await teacher.GET(new NextRequest("http://localhost/api/teacher/session?code=ZZZZZZZZ"));
    assert.equal(a.status, 400);
    assert.equal(b.status, 400);
    assert.ok(Date.now() - t0 < 500);
  });

  test("QA round 3: /api/mastery {learnerId, valid token} -> 503, not 200 store=memory", async () => {
    const learnerId = "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    const res = await mastery.POST(
      post(
        "/api/mastery",
        JSON.stringify({ learnerId, learnerToken: issueLearnerToken(learnerId) }),
      ),
    );
    assert.equal(res.status, 503);
    assert.ok(Number(res.headers.get("Retry-After")) >= 1);
    const body = (await res.json()) as { error?: string; store?: string };
    assert.equal(body.store, undefined);
    assert.match(String(body.error ?? ""), /temporarily unavailable|retry/i);
  });

  test("QA round 3: grade with a valid token while DB is down still 503", async () => {
    const learnerId = "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    const res = await grade.POST(
      post(
        "/api/diagnostic/grade",
        JSON.stringify({
          grade: "4",
          learnerId,
          learnerToken: issueLearnerToken(learnerId),
          questions: [question],
          answers: [{ questionId: "q0", answer: "5" }],
        }),
      ),
    );
    assert.equal(res.status, 503);
    assert.ok(res.headers.get("Retry-After"));
  });
});
