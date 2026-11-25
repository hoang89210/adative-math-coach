import fs from "fs";
import path from "path";
import { connection, NextResponse } from "next/server";
import { dbEnabled, getDatabaseUrl, sessionStoreKind } from "@/lib/db/client";
import { NODES_PATH, RELATIONSHIPS_PATH } from "@/lib/data/paths";
import { readJsonlFirstLine } from "@/lib/data/read-jsonl";
import { sanitizeDbError } from "@/lib/sanitize-error";

/**
 * GET /api/health response shape:
 *
 * {
 *   ok: boolean,          // backward-compat overall status
 *   okContent: boolean,   // required content is loaded: data/math-index.json exists
 *                         // (nodes.jsonl is optional on Vercel; indexes are enough)
 *   okDb: boolean | null, // true = `select 1` succeeded;
 *                         // false = DB configured but the check failed;
 *                         // null = no DATABASE_URL / POSTGRES_* configured
 *   dbError?: string,     // only when okDb === false; sanitized (no URI / password / token)
 *   env: { dbOk, hasDatabaseUrl, sessionStore, ... },  // dbOk mirrors okDb
 *   data: { mathIndexExists, nodesExists, readError, ... }
 * }
 *
 * `ok` is true when okContent is true AND the session store can work:
 *   - okDb === true, or
 *   - no DB configured and a non-Postgres store (blob / local-fs / tmp-fs) is in use, or
 *     a local full JSONL dataset is readable.
 * If okDb === false, `ok` is false (sessions cannot be saved to Postgres).
 */
export async function GET() {
  // Health must run at request time so okDb / dbError reflect the live DB,
  // not a value frozen during `next build`.
  await connection();

  const nodesExists = fs.existsSync(NODES_PATH);
  const relationshipsExists = fs.existsSync(RELATIONSHIPS_PATH);
  const mathIndexPath = path.join(process.cwd(), "data", "math-index.json");
  const mathIndexExists = fs.existsSync(mathIndexPath);

  let sampleNode: unknown = null;
  let readError: string | null = null;
  let dbOk: boolean | null = null;
  let dbError: string | undefined;

  try {
    if (nodesExists) {
      sampleNode = await readJsonlFirstLine(NODES_PATH);
    }
  } catch (err) {
    readError = err instanceof Error ? err.message : String(err);
  }

  if (dbEnabled()) {
    try {
      const { dbQuery } = await import("@/lib/db/client");
      await dbQuery("select 1 as ok");
      dbOk = true;
    } catch (err) {
      dbOk = false;
      dbError = sanitizeDbError(err);
    }
  }

  const store = sessionStoreKind();
  const okContent = mathIndexExists;
  const okDb = dbOk;
  const storeFallbackOk =
    store === "vercel-blob" ||
    store === "local-fs" ||
    store === "tmp-fs" ||
    (!process.env.VERCEL &&
      nodesExists &&
      relationshipsExists &&
      sampleNode !== null);
  const ok = Boolean(okContent && (okDb === true || (okDb === null && storeFallbackOk)));

  return NextResponse.json({
    ok,
    okContent,
    okDb,
    ...(dbError ? { dbError } : {}),
    env: {
      hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
      hasXaiKey: Boolean(process.env.XAI_API_KEY?.trim()),
      acceptsUserApiKey: true,
      hasDatabaseUrl: Boolean(getDatabaseUrl()),
      hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()),
      sessionStore: store,
      dbOk,
      llmModel: process.env.LLM_MODEL || "gpt-4o-mini",
      onVercel: Boolean(process.env.VERCEL),
    },
    data: {
      mathIndexPath,
      mathIndexExists,
      nodesPath: NODES_PATH,
      relationshipsPath: RELATIONSHIPS_PATH,
      nodesExists,
      relationshipsExists,
      sampleNodeType:
        sampleNode && typeof sampleNode === "object" && "type" in sampleNode
          ? (sampleNode as { type: string }).type
          : null,
      sampleLabels:
        sampleNode && typeof sampleNode === "object" && "labels" in sampleNode
          ? (sampleNode as { labels: string[] }).labels
          : null,
      readError,
    },
  });
}
