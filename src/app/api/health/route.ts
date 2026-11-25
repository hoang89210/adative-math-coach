import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { dbEnabled, getDatabaseUrl, sessionStoreKind } from "@/lib/db/client";
import { NODES_PATH, RELATIONSHIPS_PATH } from "@/lib/data/paths";
import { readJsonlFirstLine } from "@/lib/data/read-jsonl";

export async function GET() {
  const nodesExists = fs.existsSync(NODES_PATH);
  const relationshipsExists = fs.existsSync(RELATIONSHIPS_PATH);
  const mathIndexPath = path.join(process.cwd(), "data", "math-index.json");
  const mathIndexExists = fs.existsSync(mathIndexPath);

  let sampleNode: unknown = null;
  let readError: string | null = null;
  let dbOk: boolean | null = null;

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
    } catch {
      dbOk = false;
    }
  }

  const store = sessionStoreKind();
  const ok =
    mathIndexExists &&
    (dbOk === true ||
      store === "vercel-blob" ||
      store === "local-fs" ||
      store === "tmp-fs" ||
      (!process.env.VERCEL &&
        nodesExists &&
        relationshipsExists &&
        sampleNode !== null));

  return NextResponse.json({
    ok: Boolean(ok && dbOk !== false),
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
