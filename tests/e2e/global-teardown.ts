import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import {
  clearRunManifest,
  getConfiguredDatabaseUrl,
  readRunManifest,
} from "./helpers";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function walkFiles(dir: string, acc: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
}

function scrubLeakedApiKeys() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return;
  const files: string[] = [];
  walkFiles(path.join(process.cwd(), "test-results"), files);
  walkFiles(path.join(process.cwd(), "playwright-report"), files);
  let scrubbed = 0;
  for (const f of files) {
    try {
      const data = fs.readFileSync(f);
      if (data.includes(key)) {
        fs.unlinkSync(f);
        scrubbed += 1;
      }
    } catch {
      // ignore
    }
  }
  if (scrubbed > 0) {
    console.log(`[e2e] scrubbed ${scrubbed} artifact file(s) that contained a secret`);
  }
}

function cleanupLocalFiles(sessionIds: string[], learnerIds: string[]) {
  let deleted = 0;
  for (const id of sessionIds) {
    if (!UUID_RE.test(id)) continue;
    const p = path.join(process.cwd(), "data", "sessions", `${id}.json`);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      deleted += 1;
    }
  }
  for (const id of learnerIds) {
    if (!UUID_RE.test(id)) continue;
    const p = path.join(process.cwd(), "data", "learners", `${id}.json`);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      deleted += 1;
    }
  }
  if (deleted > 0) {
    console.log(`[e2e] cleaned up ${deleted} local-fs test artifact(s)`);
  }
}

function stripSslParams(rawUrl: string): {
  connectionString: string;
  ssl: { rejectUnauthorized: boolean } | undefined;
} {
  const url = new URL(rawUrl);
  const sslmode = (url.searchParams.get("sslmode") || "").toLowerCase();
  for (const key of [
    "sslmode",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "sslpassword",
    "sslcrl",
    "sslnegotiation",
    "uselibpqcompat",
  ]) {
    url.searchParams.delete(key);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const ssl =
    sslmode === "disable" || isLocal ? undefined : { rejectUnauthorized: false };
  return { connectionString: url.toString(), ssl };
}

async function cleanupDatabase(params: {
  sessionIds: string[];
  learnerIds: string[];
  rateKeys: string[];
}) {
  const dbUrl = getConfiguredDatabaseUrl();
  if (!dbUrl) return; // no-op when no DB is configured

  const validSessions = params.sessionIds.filter((id) => UUID_RE.test(id));
  const validLearners = params.learnerIds.filter((id) => UUID_RE.test(id));
  const validRateKeys = params.rateKeys.filter((k) => Boolean(k.trim()));

  if (
    validSessions.length === 0 &&
    validLearners.length === 0 &&
    validRateKeys.length === 0
  ) {
    return;
  }

  const { connectionString, ssl } = stripSslParams(dbUrl);
  const pool = new Pool({
    connectionString,
    ssl,
    max: 2,
    connectionTimeoutMillis: 3_000,
    query_timeout: 5_000,
  });

  try {
    if (validSessions.length > 0) {
      await pool.query(
        `delete from amc_events where session_id = ANY($1::uuid[])`,
        [validSessions],
      );
      await pool.query(`delete from amc_sessions where id = ANY($1::uuid[])`, [
        validSessions,
      ]);
    }
    if (validLearners.length > 0) {
      await pool.query(
        `delete from amc_events where learner_id = ANY($1::uuid[])`,
        [validLearners],
      );
      await pool.query(`delete from amc_learners where id = ANY($1::uuid[])`, [
        validLearners,
      ]);
    }
    if (validRateKeys.length > 0) {
      await pool.query(
        `delete from amc_rate_limits where rate_key = ANY($1::text[])`,
        [validRateKeys],
      );
    }
    console.log(
      `[e2e] DB cleanup complete (sessions=${validSessions.length}, learners=${validLearners.length}, rateKeys=${validRateKeys.length})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[e2e] DB cleanup skipped/failed: ${msg}`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/**
 * Deletes ONLY data created during THIS test run (recorded in the run manifest).
 * No-op if nothing was tracked or no DB is configured. Never runs broad pattern deletes.
 */
export default async function globalTeardown() {
  scrubLeakedApiKeys();

  const manifest = readRunManifest();
  const totalTracked =
    manifest.sessionIds.length +
    manifest.learnerIds.length +
    manifest.rateKeys.length;

  if (totalTracked === 0) {
    clearRunManifest();
    return;
  }

  cleanupLocalFiles(manifest.sessionIds, manifest.learnerIds);
  await cleanupDatabase(manifest);
  clearRunManifest();
}
