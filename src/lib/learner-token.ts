import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "crypto";
import { getDatabaseUrl } from "@/lib/db/client";
import { isValidLearnerId } from "@/lib/lc-mastery-store";

/**
 * Stateless learner ownership token.
 *
 * Issued by POST /api/learners on `create` and on a successful PIN `login`;
 * kept by the browser in sessionStorage (`learnerToken`) next to
 * `learnerId`. Required for anything that WRITES evidence for a learner
 * (diagnostic grade -> LC posteriors + learner merge) and for reading the
 * learner's cumulative mastery by learnerId. Proves the caller created the
 * learner or knows its PIN — a bare learnerId UUID is not enough.
 *
 * Format: `v1.<expUnixSec>.<base64url HMAC-SHA256(learnerId|exp)>`
 * (the learnerId is not embedded; the caller sends it separately).
 *
 * Key: HKDF-SHA256 over AMC_LEARNER_TOKEN_SECRET if set, else over the
 * database URL (already a server secret; rotating the DB password therefore
 * invalidates outstanding tokens -> learners sign in again). With neither,
 * a random per-process key (local dev / no-DB demo). The key and tokens are
 * never logged.
 */

export const LEARNER_TOKEN_TTL_SEC = 7 * 24 * 60 * 60;
const INFO = "amc-learner-token-v1";

let cachedKey: { source: string; key: Buffer } | null = null;
let processKey: Buffer | null = null;

function signingKey(): Buffer {
  const secret = process.env.AMC_LEARNER_TOKEN_SECRET?.trim() || getDatabaseUrl() || "";
  if (!secret) {
    processKey ??= randomBytes(32);
    return processKey;
  }
  if (cachedKey?.source === secret) return cachedKey.key;
  const key = Buffer.from(hkdfSync("sha256", secret, "amc-learner", INFO, 32));
  cachedKey = { source: secret, key };
  return key;
}

function mac(learnerId: string, exp: number): string {
  return createHmac("sha256", signingKey())
    .update(`${learnerId.toLowerCase()}|${exp}`)
    .digest("base64url");
}

export function issueLearnerToken(learnerId: string, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + LEARNER_TOKEN_TTL_SEC;
  return `v1.${exp}.${mac(learnerId, exp)}`;
}

export type LearnerTokenCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" };

export function verifyLearnerToken(
  learnerId: string,
  token: unknown,
  nowMs = Date.now(),
): LearnerTokenCheck {
  if (token === undefined || token === null || token === "") {
    return { ok: false, reason: "missing" };
  }
  if (typeof token !== "string" || token.length > 200 || !isValidLearnerId(learnerId)) {
    return { ok: false, reason: "malformed" };
  }
  const m = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return { ok: false, reason: "malformed" };
  const exp = Number(m[1]);
  if (exp * 1000 < nowMs) return { ok: false, reason: "expired" };
  const expected = Buffer.from(mac(learnerId, exp));
  const got = Buffer.from(m[2]);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}

/** Test-only: forget cached keys (e.g. after changing env). */
export function resetLearnerTokenKeyForTests() {
  cachedKey = null;
  processKey = null;
}
