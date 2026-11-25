import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { NODES_PATH, RELATIONSHIPS_PATH } from "@/lib/data/paths";
import { readJsonlFirstLine } from "@/lib/data/read-jsonl";

export async function GET() {
  const nodesExists = fs.existsSync(NODES_PATH);
  const relationshipsExists = fs.existsSync(RELATIONSHIPS_PATH);
  const mathIndexPath = path.join(process.cwd(), "data", "math-index.json");
  const mathIndexExists = fs.existsSync(mathIndexPath);

  let sampleNode: unknown = null;
  let readError: string | null = null;

  try {
    if (nodesExists) {
      sampleNode = await readJsonlFirstLine(NODES_PATH);
    }
  } catch (err) {
    readError = err instanceof Error ? err.message : String(err);
  }

  // Prod deploys indexes only (no full JSONL). Local monorepo has JSONL.
  const ok =
    mathIndexExists ||
    (nodesExists &&
      relationshipsExists &&
      sampleNode !== null &&
      readError === null);

  return NextResponse.json({
    ok,
    env: {
      hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
      hasXaiKey: Boolean(process.env.XAI_API_KEY?.trim()),
      acceptsUserApiKey: true,
      hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()),
      sessionStore: process.env.BLOB_READ_WRITE_TOKEN?.trim()
        ? "vercel-blob"
        : "local-fs",
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
