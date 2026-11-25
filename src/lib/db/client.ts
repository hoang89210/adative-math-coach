import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export function getDatabaseUrl(): string | null {
  const url =
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    null;
  return url || null;
}

export function dbEnabled() {
  return Boolean(getDatabaseUrl());
}

export function getPool(): Pool {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error("No DATABASE_URL / POSTGRES_URL configured");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getPool().query<T>(text, params);
}

export async function withDbClient<T>(fn: (c: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export function sessionStoreKind():
  | "supabase"
  | "vercel-blob"
  | "local-fs"
  | "tmp-fs"
  | "none" {
  if (dbEnabled()) return "supabase";
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return "vercel-blob";
  if (process.env.VERCEL) return "tmp-fs";
  return "local-fs";
}
