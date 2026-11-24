import { get, list, put } from "@vercel/blob";
import fs from "fs";
import path from "path";
import type { MasteryRecord } from "./mastery-types";

const memory = new Map<string, MasteryRecord>();

function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function storeDir() {
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

export async function storeSave(record: MasteryRecord): Promise<MasteryRecord> {
  memory.set(record.id, record);
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

  ensureDir();
  fs.writeFileSync(
    path.join(storeDir(), `${record.id}.json`),
    JSON.stringify(record, null, 2),
    "utf8",
  );
  return record;
}

export async function storeLoad(id: string): Promise<MasteryRecord | null> {
  const cached = memory.get(id);
  if (cached) return cached;

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
        const hit = listed.blobs.find((b) =>
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

  const file = path.join(storeDir(), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const record = JSON.parse(fs.readFileSync(file, "utf8")) as MasteryRecord;
  memory.set(id, record);
  return record;
}

export async function storeResolveSessionId(
  input: string,
): Promise<string | null> {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  if (await storeLoad(raw)) return raw;

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

  const dir = storeDir();
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const id = f.replace(/\.json$/, "");
    if (id.replace(/-/g, "").toLowerCase().startsWith(prefix)) {
      return id;
    }
  }
  return null;
}
