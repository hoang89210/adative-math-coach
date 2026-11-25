/**
 * Build node-pg Pool options so our SSL settings are the final word.
 *
 * Why this exists: pg 8.23 / pg-connection-string 2.14 parse the URI *after*
 * merging Pool options (`Object.assign({}, config, parse(connectionString))`).
 * So `ssl: { rejectUnauthorized: false }` on the Pool is overwritten when the
 * URI contains `sslmode=require`. In 2.14, `require` is treated as
 * `verify-full`, which fails against the Supabase/Vercel pooler cert
 * (`SELF_SIGNED_CERT_IN_CHAIN`) unless NODE_TLS_REJECT_UNAUTHORIZED=0 is set
 * (which disables TLS verification for *all* outbound connections — too broad).
 *
 * Approach: strip sslmode / sslrootcert / related query params from the URI,
 * then pass `ssl` as a separate Pool option. With those params gone, parse()
 * no longer synthesizes an ssl object, so our override sticks. This is more
 * reliable than `uselibpqcompat=true`, which still depends on pg-connection-string
 * semantics that are scheduled to change again in v3.
 *
 * Local (`localhost` / `127.0.0.1` / `::1`) and `sslmode=disable` stay
 * unencrypted, matching previous behavior.
 */

const SSL_QUERY_KEYS = new Set([
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "sslpassword",
  "sslcrl",
  "sslnegotiation",
  "uselibpqcompat",
]);

export type PoolSslOption =
  | undefined
  | false
  | { rejectUnauthorized: boolean; ca?: string };

export type BuiltPoolConfig = {
  connectionString: string;
  ssl: PoolSslOption;
};

function isLocalHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function stripSslQueryParams(url: URL) {
  const removed = new Map<string, string>();
  for (const key of [...url.searchParams.keys()]) {
    if (SSL_QUERY_KEYS.has(key.toLowerCase())) {
      const value = url.searchParams.get(key);
      if (value != null) removed.set(key.toLowerCase(), value);
      url.searchParams.delete(key);
    }
  }
  return removed;
}

/**
 * Parse a postgres URI, strip SSL query params, and return Pool options.
 * Passwords (including percent-encoded special characters) are preserved.
 */
export function buildPoolConfig(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): BuiltPoolConfig {
  const url = new URL(connectionString);
  const removed = stripSslQueryParams(url);
  const sslmode = (removed.get("sslmode") || "").toLowerCase();
  const cleaned = url.toString();

  if (sslmode === "disable" || isLocalHost(url.hostname)) {
    return { connectionString: cleaned, ssl: undefined };
  }

  const ca = env.DATABASE_CA_CERT?.trim();
  if (ca) {
    return {
      connectionString: cleaned,
      ssl: { rejectUnauthorized: true, ca },
    };
  }

  // TODO: honor sslmode=verify-full / verify-ca with the platform CA store
  // when no DATABASE_CA_CERT is set. Until then, remote connections encrypt
  // but do not verify — required for the Supabase pooler cert chain.
  return {
    connectionString: cleaned,
    ssl: { rejectUnauthorized: false },
  };
}
