import { NextResponse } from "next/server";
import { dbFailFastResponseInit, isDbTimeoutError } from "@/lib/db/client";
import { sanitizeDbError } from "@/lib/sanitize-error";

/**
 * Shared API error handling.
 *
 *   HttpError            -> its status + public message
 *   malformed JSON body  -> 400 "Invalid JSON body" (never the parser text)
 *   DB unavailable       -> 503 + Retry-After (same as learner create/login)
 *   anything else        -> 500 with a sanitized message (no URIs / keys)
 */

export const DEFAULT_MAX_JSON_BYTES = 256 * 1024;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Read and parse a JSON request body with a size cap. Throws HttpError:
 * 413 when larger than `maxBytes`, 400 when empty / malformed / not an object.
 */
export async function readJsonBody<T = Record<string, unknown>>(
  request: Request,
  maxBytes: number = DEFAULT_MAX_JSON_BYTES,
): Promise<T> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "Request body too large");
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new HttpError(400, "Invalid request body");
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new HttpError(413, "Request body too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "JSON body must be an object");
  }
  return parsed as T;
}

export const DB_UNAVAILABLE_MESSAGE =
  "Database temporarily unavailable. Please retry shortly.";

/** 503 + Retry-After response when `err` is a DB timeout / unavailable error. */
export function dbUnavailableResponse(err: unknown): NextResponse | null {
  if (!isDbTimeoutError(err)) return null;
  return NextResponse.json(
    { error: DB_UNAVAILABLE_MESSAGE },
    dbFailFastResponseInit(),
  );
}

export function errorResponse(
  err: unknown,
  opts: { fallbackStatus?: number; fallbackMessage?: string } = {},
): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const db = dbUnavailableResponse(err);
  if (db) return db;
  return NextResponse.json(
    { error: opts.fallbackMessage ?? (sanitizeDbError(err) || "Request failed") },
    { status: opts.fallbackStatus ?? 500 },
  );
}
