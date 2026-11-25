import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import { get, list, put } from "@vercel/blob";
import type { CoverageReport } from "./analytics/coverage";
import { dbEnabled, dbQuery, isDbTimeoutError } from "./db/client";
import { logError } from "./log-safe";

import type { GradeResult } from "./types/quiz";

export type MasteryStatus = "unknown" | "emerging" | "mastered" | "stale";

export type ComponentMasteryEntry = {
  status: MasteryStatus;
  correct: number;
  attempts: number;
  lastAt: string;
  lastGrade: string;
};

export type LearnerProfile = {
  id: string;
  publicCode: string;
  pinHash: string;
  pinSalt: string;
  createdAt: string;
  updatedAt: string;
  currentGrade?: string;
  jurisdiction?: string;
  sessionIds: string[];
  componentMastery: Record<string, ComponentMasteryEntry>;
  coverageHistory: Array<{
    at: string;
    sessionId: string;
    grade: string;
    overallPct: number;
  }>;
};

const memory = new Map<string, LearnerProfile>();

function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function learnersDir() {
  if (process.env.VERCEL) return path.join("/tmp", "amc-learners");
  return path.join(process.cwd(), "data", "learners");
}

function ensureDir() {
  const d = learnersDir();
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function hashPin(pin: string, salt: string) {
  return scryptSync(pin, salt, 32).toString("hex");
}

function makePublicCode() {
  const raw = randomBytes(3).toString("hex").toUpperCase();
  return `MATH-${raw}`;
}

function blobPath(id: string) {
  return `learners/${id}.json`;
}

function cacheProfile(p: LearnerProfile) {
  memory.set(p.id, p);
  memory.set(p.publicCode.toUpperCase(), p);
}

function rowToProfile(row: Record<string, unknown>): LearnerProfile {
  return {
    id: String(row.id),
    publicCode: String(row.public_code),
    pinHash: String(row.pin_hash),
    pinSalt: String(row.pin_salt),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    currentGrade: row.current_grade ? String(row.current_grade) : undefined,
    jurisdiction: row.jurisdiction ? String(row.jurisdiction) : undefined,
    sessionIds: Array.isArray(row.session_ids)
      ? (row.session_ids as string[])
      : typeof row.session_ids === "string"
        ? (JSON.parse(row.session_ids) as string[])
        : [],
    componentMastery:
      (row.component_mastery as LearnerProfile["componentMastery"]) || {},
    coverageHistory:
      (row.coverage_history as LearnerProfile["coverageHistory"]) || [],
  };
}

async function pgSave(profile: LearnerProfile) {
  await dbQuery(
    `insert into amc_learners (
      id, public_code, pin_hash, pin_salt, current_grade, jurisdiction,
      component_mastery, coverage_history, session_ids, created_at, updated_at
    ) values (
      $1::uuid, $2, $3, $4, $5, $6,
      $7::jsonb, $8::jsonb, $9::jsonb,
      coalesce($10::timestamptz, now()), now()
    )
    on conflict (id) do update set
      public_code = excluded.public_code,
      pin_hash = excluded.pin_hash,
      pin_salt = excluded.pin_salt,
      current_grade = excluded.current_grade,
      jurisdiction = excluded.jurisdiction,
      component_mastery = excluded.component_mastery,
      coverage_history = excluded.coverage_history,
      session_ids = excluded.session_ids,
      updated_at = now()`,
    [
      profile.id,
      profile.publicCode,
      profile.pinHash,
      profile.pinSalt,
      profile.currentGrade || null,
      profile.jurisdiction || null,
      JSON.stringify(profile.componentMastery || {}),
      JSON.stringify(profile.coverageHistory || []),
      JSON.stringify(profile.sessionIds || []),
      profile.createdAt || null,
    ],
  );
}

async function pgLoadById(id: string): Promise<LearnerProfile | null> {
  const r = await dbQuery(`select * from amc_learners where id = $1::uuid`, [
    id,
  ]);
  if (!r.rows[0]) return null;
  return rowToProfile(r.rows[0] as Record<string, unknown>);
}

async function pgLoadByCode(code: string): Promise<LearnerProfile | null> {
  const r = await dbQuery(
    `select * from amc_learners where upper(public_code) = upper($1) limit 1`,
    [code],
  );
  if (!r.rows[0]) return null;
  return rowToProfile(r.rows[0] as Record<string, unknown>);
}

async function saveLearner(profile: LearnerProfile) {
  profile.updatedAt = new Date().toISOString();
  cacheProfile(profile);

  if (dbEnabled()) {
    await pgSave(profile);
    return profile;
  }

  const body = JSON.stringify(profile);
  if (blobEnabled()) {
    await put(blobPath(profile.id), body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return profile;
  }

  try {
    ensureDir();
    fs.writeFileSync(
      path.join(learnersDir(), `${profile.id}.json`),
      JSON.stringify(profile, null, 2),
      "utf8",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Learner save failed (${msg}). On Vercel set POSTGRES_URL (Supabase).`,
    );
  }
  return profile;
}

async function loadById(id: string): Promise<LearnerProfile | null> {
  if (memory.has(id)) return memory.get(id)!;

  if (dbEnabled()) {
    try {
      const p = await pgLoadById(id);
      if (p) cacheProfile(p);
      return p;
    } catch (err) {
      if (isDbTimeoutError(err)) throw err;
      logError("pg learner load failed", err);
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
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const text = await new Response(result.stream).text();
      const p = JSON.parse(text) as LearnerProfile;
      cacheProfile(p);
      return p;
    } catch {
      return null;
    }
  }

  try {
    const file = path.join(learnersDir(), `${id}.json`);
    if (!fs.existsSync(file)) return null;
    const p = JSON.parse(fs.readFileSync(file, "utf8")) as LearnerProfile;
    cacheProfile(p);
    return p;
  } catch {
    return null;
  }
}

export async function findLearnerByCode(
  code: string,
): Promise<LearnerProfile | null> {
  const key = code.trim().toUpperCase();
  if (memory.has(key)) return memory.get(key)!;

  if (dbEnabled()) {
    try {
      const p = await pgLoadByCode(key);
      if (p) cacheProfile(p);
      return p;
    } catch (err) {
      if (isDbTimeoutError(err)) throw err;
      return null;
    }
  }

  if (blobEnabled()) {
    try {
      const listed = await list({
        prefix: "learners/",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      for (const b of listed.blobs) {
        const res = await fetch(b.url, { cache: "no-store" });
        if (!res.ok) continue;
        const p = (await res.json()) as LearnerProfile;
        cacheProfile(p);
        if (p.publicCode.toUpperCase() === key) return p;
      }
    } catch {
      return null;
    }
    return null;
  }

  try {
    ensureDir();
    for (const f of fs.readdirSync(learnersDir())) {
      if (!f.endsWith(".json")) continue;
      const p = JSON.parse(
        fs.readFileSync(path.join(learnersDir(), f), "utf8"),
      ) as LearnerProfile;
      cacheProfile(p);
      if (p.publicCode.toUpperCase() === key) return p;
    }
  } catch {
    return null;
  }
  return null;
}

export async function createLearner(params: {
  pin: string;
  grade?: string;
  jurisdiction?: string;
}): Promise<{ profile: LearnerProfile; pin: string }> {
  const pin = params.pin.replace(/\D/g, "");
  if (pin.length < 4 || pin.length > 6) {
    throw new Error("PIN must be 4–6 digits");
  }
  const salt = randomBytes(8).toString("hex");
  const id = randomUUID();
  const profile: LearnerProfile = {
    id,
    publicCode: makePublicCode(),
    pinHash: hashPin(pin, salt),
    pinSalt: salt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentGrade: params.grade,
    jurisdiction: params.jurisdiction,
    sessionIds: [],
    componentMastery: {},
    coverageHistory: [],
  };
  await saveLearner(profile);
  return { profile, pin };
}

export async function verifyLearnerPin(
  code: string,
  pin: string,
): Promise<LearnerProfile | null> {
  const profile = await findLearnerByCode(code);
  if (!profile) return null;
  const attempt = hashPin(pin.replace(/\D/g, ""), profile.pinSalt);
  const a = Buffer.from(attempt, "hex");
  const b = Buffer.from(profile.pinHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return profile;
}

export async function mergeDiagnosticIntoLearner(params: {
  learnerId: string;
  sessionId: string;
  grade: string;
  result: GradeResult;
  coverage?: CoverageReport | null;
}) {
  const profile = await loadById(params.learnerId);
  if (!profile) throw new Error("learner not found");

  if (!profile.sessionIds.includes(params.sessionId)) {
    profile.sessionIds.push(params.sessionId);
  }
  profile.currentGrade = params.grade;

  for (const row of params.result.byComponent) {
    const prev = profile.componentMastery[row.componentId] ?? {
      status: "unknown" as MasteryStatus,
      correct: 0,
      attempts: 0,
      lastAt: new Date().toISOString(),
      lastGrade: params.grade,
    };
    prev.attempts += row.total;
    prev.correct += row.correct;
    prev.lastAt = new Date().toISOString();
    prev.lastGrade = params.grade;
    const rate = prev.attempts ? prev.correct / prev.attempts : 0;
    if (row.mastered || rate >= 0.85) prev.status = "mastered";
    else prev.status = "emerging";
    profile.componentMastery[row.componentId] = prev;
  }

  if (params.coverage) {
    profile.coverageHistory.push({
      at: new Date().toISOString(),
      sessionId: params.sessionId,
      grade: params.grade,
      overallPct: params.coverage.overallPct,
    });
    profile.coverageHistory = profile.coverageHistory.slice(-20);
  }

  await saveLearner(profile);
  return profile;
}

export function publicLearnerView(profile: LearnerProfile) {
  const mastery = Object.entries(profile.componentMastery);
  return {
    publicCode: profile.publicCode,
    currentGrade: profile.currentGrade,
    jurisdiction: profile.jurisdiction,
    sessionCount: profile.sessionIds.length,
    mastered: mastery.filter(([, m]) => m.status === "mastered").length,
    emerging: mastery.filter(([, m]) => m.status === "emerging").length,
    coverageHistory: profile.coverageHistory,
    recentMastery: mastery
      .sort((a, b) => b[1].lastAt.localeCompare(a[1].lastAt))
      .slice(0, 20)
      .map(([componentId, m]) => ({ componentId, ...m })),
  };
}
