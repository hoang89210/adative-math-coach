import { get, list, put } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { dbEnabled, dbQuery, isDbTimeoutError } from "@/lib/db/client";
import { logError } from "@/lib/log-safe";

import type { MasteryRecord } from "./mastery-types";
import {
  isSessionUuid,
  isValidSessionRef,
  sessionShortCode,
} from "./mastery-codes";

const memory = new Map<string, MasteryRecord>();

function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function storeDir() {
  if (process.env.VERCEL) {
    return path.join("/tmp", "amc-sessions");
  }
  return path.join(process.cwd(), "data", "sessions");
}

function ensureDir() {
  const dir = storeDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function blobPath(id: string) {
  return `sessions/${id}.json`;
}

function rowToRecord(row: Record<string, unknown>): MasteryRecord {
  return {
    id: String(row.id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    grade: String(row.grade),
    jurisdiction: row.jurisdiction ? String(row.jurisdiction) : undefined,
    learnerId: row.learner_id ? String(row.learner_id) : undefined,
    result: (row.result as MasteryRecord["result"]) || {
      grade: String(row.grade),
      score: 0,
      total: 0,
      percent: 0,
      byComponent: [],
      weakComponents: [],
      strongComponents: [],
    },
    roadmap: (row.roadmap as MasteryRecord["roadmap"]) || undefined,
    coverage: row.coverage ?? undefined,
    artifacts: (row.artifacts as MasteryRecord["artifacts"]) || undefined,
  };
}

async function pgSave(record: MasteryRecord) {
  const short = sessionShortCode(record.id);
  await dbQuery(
    `insert into amc_sessions (
      id, short_code, learner_id, grade, jurisdiction,
      percent, score, total, result, roadmap, coverage, artifacts, created_at, updated_at
    ) values (
      $1::uuid, $2, $3::uuid, $4, $5,
      $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
      coalesce($13::timestamptz, now()), now()
    )
    on conflict (id) do update set
      short_code = excluded.short_code,
      learner_id = excluded.learner_id,
      grade = excluded.grade,
      jurisdiction = excluded.jurisdiction,
      percent = excluded.percent,
      score = excluded.score,
      total = excluded.total,
      result = excluded.result,
      roadmap = excluded.roadmap,
      coverage = excluded.coverage,
      artifacts = excluded.artifacts,
      updated_at = now()`,
    [
      record.id,
      short,
      record.learnerId || null,
      record.grade,
      record.jurisdiction || null,
      record.result?.percent ?? null,
      record.result?.score ?? null,
      record.result?.total ?? null,
      JSON.stringify(record.result ?? {}),
      record.roadmap ? JSON.stringify(record.roadmap) : null,
      record.coverage ? JSON.stringify(record.coverage) : null,
      JSON.stringify(record.artifacts ?? {}),
      record.createdAt || null,
    ],
  );
}

async function pgLoad(id: string): Promise<MasteryRecord | null> {
  const r = await dbQuery(`select * from amc_sessions where id = $1::uuid limit 1`, [
    id,
  ]);
  if (!r.rows[0]) return null;
  return rowToRecord(r.rows[0] as Record<string, unknown>);
}

async function pgResolveByPrefix(prefix: string): Promise<string | null> {
  const r = await dbQuery(
    `select id from amc_sessions
     where short_code ilike $1 or replace(id::text, '-', '') ilike $2
     order by created_at desc limit 1`,
    [prefix.toUpperCase(), `${prefix}%`],
  );
  return r.rows[0] ? String(r.rows[0].id) : null;
}

export async function storeSave(record: MasteryRecord): Promise<MasteryRecord> {
  memory.set(record.id, record);

  if (dbEnabled()) {
    try {
      await pgSave(record);
    } catch (err) {
      // do not leave an unsaved session in the per-instance cache
      memory.delete(record.id);
      throw err;
    }
    return record;
  }

  const body = JSON.stringify(record);

  if (blobEnabled()) {
    await put(blobPath(record.id), body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return record;
  }

  // Local or Vercel /tmp fallback (ephemeral on serverless)
  try {
    ensureDir();
    fs.writeFileSync(
      path.join(storeDir(), `${record.id}.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Session save failed (${msg}). On Vercel set POSTGRES_URL (Supabase) or BLOB_READ_WRITE_TOKEN.`,
    );
  }
  return record;
}

/**
 * Load a session by id. Returns null for "not found" (including ids that are
 * not UUIDs — no DB round-trip, no path traversal). THROWS when the DB is
 * unavailable / timing out so routes can answer 503 + Retry-After instead of
 * a misleading 404.
 */
export async function storeLoad(id: string): Promise<MasteryRecord | null> {
  if (!isSessionUuid(String(id ?? ""))) return null;
  const cached = memory.get(id);
  if (cached) return cached;

  if (dbEnabled()) {
    try {
      const rec = await pgLoad(id);
      if (rec) memory.set(id, rec);
      return rec;
    } catch (err) {
      if (isDbTimeoutError(err)) throw err;
      logError("pg session load failed", err);
      return null;
    }
  }

  if (blobEnabled()) {
    try {
      const result = await get(blobPath(id), {
        access: "public",
        useCache: false,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        return null;
      }
      const text = await new Response(result.stream).text();
      const record = JSON.parse(text) as MasteryRecord;
      memory.set(id, record);
      return record;
    } catch {
      try {
        const listed = await list({
          prefix: "sessions/",
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        const hit = listed.blobs.find(
          (b) =>
            b.pathname.replace(/\\/g, "/").endsWith(`sessions/${id}.json`) ||
            b.pathname.endsWith(`${id}.json`),
        );
        if (!hit) return null;
        const res = await fetch(hit.url, { cache: "no-store" });
        if (!res.ok) return null;
        const record = (await res.json()) as MasteryRecord;
        memory.set(id, record);
        return record;
      } catch {
        return null;
      }
    }
  }

  try {
    const file = path.join(storeDir(), `${id}.json`);
    if (!fs.existsSync(file)) return null;
    const record = JSON.parse(fs.readFileSync(file, "utf8")) as MasteryRecord;
    memory.set(id, record);
    return record;
  } catch {
    return null;
  }
}

export async function storeResolveSessionId(
  input: string,
): Promise<string | null> {
  const raw = String(input ?? "").trim();
  if (!isValidSessionRef(raw)) return null;

  if (isSessionUuid(raw) && (await storeLoad(raw))) return raw;

  const compact = raw.replace(/-/g, "").toLowerCase();
  if (compact.length >= 32) {
    const uuid = [
      compact.slice(0, 8),
      compact.slice(8, 12),
      compact.slice(12, 16),
      compact.slice(16, 20),
      compact.slice(20, 32),
    ].join("-");
    if (await storeLoad(uuid)) return uuid;
  }

  if (compact.length < 8) return null;
  const prefix = compact.slice(0, 8);

  if (dbEnabled()) {
    try {
      return await pgResolveByPrefix(prefix);
    } catch (err) {
      if (isDbTimeoutError(err)) throw err;
      logError("pg session prefix lookup failed", err);
      return null;
    }
  }

  if (blobEnabled()) {
    try {
      const listed = await list({
        prefix: "sessions/",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      for (const b of listed.blobs) {
        const name = b.pathname.split("/").pop()?.replace(/\.json$/, "") ?? "";
        if (name.replace(/-/g, "").toLowerCase().startsWith(prefix)) {
          return name;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  try {
    const dir = storeDir();
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const id = f.replace(/\.json$/, "");
      if (id.replace(/-/g, "").toLowerCase().startsWith(prefix)) {
        return id;
      }
    }
  } catch {
    return null;
  }
  return null;
}
