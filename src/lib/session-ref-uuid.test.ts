import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

/**
 * QA bug 6 regression: a VALID 8-char short code (e.g. CF0F8624) must not
 * be sent to `where id = $1::uuid` (Postgres logs "invalid input syntax for
 * type uuid"). Only a full, valid UUID may hit the uuid lookup. Uses a DB URL
 * on a closed port and observes SQL text only. Own process.
 */
process.env.POSTGRES_URL = "postgres://u:p@127.0.0.1:1/x";

let client: typeof import("./db/client");
let mastery: typeof import("./mastery");
const seen: string[] = [];

before(async () => {
  client = await import("./db/client");
  mastery = await import("./mastery");
  client.setDbQueryObserverForTests((t) => seen.push(t));
});
after(() => client.setDbQueryObserverForTests(null));

async function queriesFor(input: string) {
  seen.length = 0;
  client.setDbUnavailableUntilForTests(0);
  try {
    await mastery.resolveSessionId(input);
  } catch {
    // DB is down on purpose; we only care which queries were attempted
  }
  return [...seen];
}

const UUID_LOOKUP = /::uuid/;

describe("bug 6: uuid lookups only for full UUIDs", () => {
  for (const code of ["CF0F8624", "cf0f8624", "3F2B8A4E"]) {
    test(`short code ${code} -> prefix lookup only, no ::uuid query`, async () => {
      const q = await queriesFor(code);
      assert.ok(q.length >= 1, "prefix lookup attempted");
      assert.ok(q.every((t) => !UUID_LOOKUP.test(t)), q.join("\n"));
      assert.ok(q.some((t) => /short_code ilike/.test(t)));
    });
  }

  test("invalid refs (ZZZZZZZZ, too short, SQL-ish) -> no DB query at all", async () => {
    for (const bad of ["ZZZZZZZZ", "abc", "'; drop table x; --", "cf0f8624-zzzz"]) {
      assert.deepEqual(await queriesFor(bad), [], bad);
    }
  });

  test("full UUID -> uuid lookup is used", async () => {
    const q = await queriesFor("cf0f8624-bc45-4df6-a990-b1fc807e00b2");
    assert.ok(q.some((t) => UUID_LOOKUP.test(t)));
  });

  test("storeLoad-style lookups never receive a short code", async () => {
    seen.length = 0;
    client.setDbUnavailableUntilForTests(0);
    assert.equal(await mastery.loadMastery("CF0F8624"), null);
    assert.deepEqual(seen, []);
  });
});
