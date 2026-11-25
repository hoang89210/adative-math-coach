import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

/** Real write / real-OpenAI flows stay skipped unless RUN_E2E=1. */
export function shouldRunE2E(): boolean {
  return process.env.RUN_E2E === "1";
}

/** Optional remote hardening checks (when targeting a live remote env). */
export function shouldRunHardening(): boolean {
  return process.env.RUN_HARDENING === "1";
}

export function isRemoteTarget(): boolean {
  const raw = process.env.BASE_URL?.trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  } catch {
    return true;
  }
}

export function getConfiguredDatabaseUrl(): string | null {
  const url =
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    null;
  return url || null;
}

export type HealthBody = {
  ok?: boolean;
  okContent?: boolean;
  okDb?: boolean | null;
  dbError?: string;
  serverTestKeyEnabled?: boolean;
  serverKeyFallbackEnabled?: boolean;
  env?: {
    hasOpenAiKey?: boolean;
    hasXaiKey?: boolean;
    acceptsUserApiKey?: boolean;
    serverTestKeyEnabled?: boolean;
    serverKeyFallbackEnabled?: boolean;
    hasDatabaseUrl?: boolean;
    hasBlobToken?: boolean;
    sessionStore?: string;
    dbOk?: boolean | null;
    llmModel?: string;
    onVercel?: boolean;
  };
  data?: {
    mathIndexExists?: boolean;
    nodesExists?: boolean;
    mathIndexPath?: string;
    nodesPath?: string;
    relationshipsPath?: string;
    readError?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/**
 * Redact anything that looks like a secret before logging health JSON.
 * Never logs Authorization, API keys, or credentialed URLs.
 */
export function redactHealth(body: HealthBody): HealthBody {
  const clone = JSON.parse(JSON.stringify(body)) as HealthBody;
  const secretish =
    /api[_-]?key|password|secret|token|authorization|bearer\s+sk-|postgres(?:ql)?:\/\/[^\s]+/i;

  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (secretish.test(value) || value.startsWith("sk-")) return "[redacted]";
      return value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (secretish.test(k)) {
          out[k] = typeof v === "boolean" ? v : "[redacted]";
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return value;
  };

  return walk(clone) as HealthBody;
}

export async function fetchHealth(
  request: APIRequestContext,
): Promise<{ status: number; body: HealthBody }> {
  const res = await request.get("/api/health");
  const body = (await res.json()) as HealthBody;
  return { status: res.status(), body };
}

export function dbOkValue(body: HealthBody): boolean | null | undefined {
  if (typeof body.okDb === "boolean" || body.okDb === null) return body.okDb;
  return body.env?.dbOk;
}

/** Preconditions for DB-backed write E2E: health must report dbOk:true (or local-fs ok:true when local). */
export function assertDbReady(body: HealthBody): void {
  const dbOk = dbOkValue(body);
  if (body.env?.sessionStore === "supabase" && dbOk !== true) {
    throw new Error(
      `Precondition failed: health dbOk is ${String(dbOk)} (need true) before DB write E2E. ` +
        `Redacted health: ${JSON.stringify(redactHealth(body))}`,
    );
  }
  if (body.ok !== true) {
    throw new Error(
      `Precondition failed: health ok is ${String(body.ok)}. ` +
        `Redacted health: ${JSON.stringify(redactHealth(body))}`,
    );
  }
}

/**
 * Read OPENAI_API_KEY from the environment. Never log or return it in
 * error messages. Throws a generic message if missing/invalid.
 */
export function readOpenAiKeyFromEnv(): string {
  const key = process.env.OPENAI_API_KEY?.trim() || "";
  if (!key.startsWith("sk-") || key.length < 20) {
    throw new Error(
      "OPENAI_API_KEY is missing or does not look like a valid key (expected sk-…, length >= 20). " +
        "Set it in the environment; do not paste it into the repo.",
    );
  }
  return key;
}

export async function fillApiKeyPanelWithKey(
  page: Page,
  key: string,
  compact = false,
): Promise<void> {
  const input = page.getByPlaceholder(/sk-proj-\.\.\. or sk-\.\.\.|sk-\.\.\./);
  await expect(input).toBeVisible();
  await input.fill(key);
  await page.getByRole("button", { name: compact ? "Save" : "Save key" }).click();
  if (compact) {
    await expect(page.getByText("OpenAI key on device")).toBeVisible();
  } else {
    await expect(page.getByText("Key saved on this device")).toBeVisible();
  }
  // Clear the visible input so Playwright snapshots cannot capture the key.
  await input.fill("");
}

export async function fillApiKeyPanel(page: Page, compact = false): Promise<void> {
  await fillApiKeyPanelWithKey(page, readOpenAiKeyFromEnv(), compact);
}

const GRADE_MATRIX: Record<string, { band: string; button: string }> = {
  K: { band: "K–2", button: "Kindergarten" },
  "4": { band: "3–5", button: "Grade 4" },
  "8": { band: "6–8", button: "Grade 8" },
  "10": { band: "9–12", button: "Grade 10" },
};

export async function selectGrade(
  page: Page,
  grade: "K" | "4" | "8" | "10",
): Promise<void> {
  const cfg = GRADE_MATRIX[grade];
  await page.getByRole("button", { name: cfg.band, exact: true }).click();
  await page.getByRole("button", { name: cfg.button, exact: true }).click();
}

/** Clear visible API-key inputs without clicking Clear (localStorage stays). */
export async function maskApiKeyInputs(page: Page): Promise<void> {
  const input = page.getByPlaceholder(/sk-proj-\.\.\. or sk-\.\.\.|sk-\.\.\./);
  const n = await input.count();
  for (let i = 0; i < n; i++) {
    const el = input.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.fill("");
    }
  }
}

/** Answer the current diagnostic item, then advance (Next / Submit). */
export async function answerCurrentQuestionAndAdvance(
  page: Page,
): Promise<"next" | "submit"> {
  const heading = page.getByRole("heading", { name: /Question \d+ of \d+/ });
  const current = (await heading.innerText()).trim();
  const option = page.locator("div.rounded-2xl button[type='button']");
  const typed = page.getByPlaceholder("Type your answer");
  if (await option.count()) {
    await option.first().click();
  } else if (await typed.count()) {
    await typed.fill("42");
  } else {
    throw new Error("TODO: no known answer control found on diagnostic question");
  }
  const submit = page.getByRole("button", { name: "Submit", exact: true });
  const next = page.getByRole("button", { name: "Next", exact: true });
  if ((await submit.isVisible()) && (await submit.isEnabled())) {
    await submit.click();
    return "submit";
  }
  await expect(next).toBeEnabled();
  await next.click();
  await expect(heading).not.toHaveText(current, { timeout: 15_000 });
  return "next";
}

/** Answer every remaining diagnostic question and wait for /results. */
export async function finishDiagnosticAndWaitForResults(
  page: Page,
): Promise<void> {
  for (let i = 0; i < 8; i++) {
    if (page.url().includes("/results")) break;
    if (await page.getByRole("heading", { name: /You scored / }).count()) break;
    await expect(
      page.getByRole("heading", { name: /Question \d+ of \d+/ }),
    ).toBeVisible();
    const step = await answerCurrentQuestionAndAdvance(page);
    if (step === "submit") break;
  }
  await expect(page).toHaveURL(/\/results/, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: /You scored / })).toBeVisible();
  await maskApiKeyInputs(page);
}

/** Playwright capture settings that must be used on any test that fills an API key. */
export const noSecretCapture = {
  trace: "off" as const,
  screenshot: "off" as const,
  video: "off" as const,
};

export type SavedE2ESession = {
  label: string;
  sessionId: string;
  shortCode: string;
  grade: string;
  score?: number;
  total?: number;
  percent?: number;
  createdAt: string;
};

/** Run tag e.g. e2e-test-20261125-154530 (Asia/Bangkok). Not a DB column. */
export function makeE2ELabel(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `e2e-test-${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
}

export function sessionArtifactPath(): string {
  // Not under test-results/: Playwright empties that folder at the start of each run.
  return path.join(process.cwd(), "e2e-artifacts", "e2e-prod-session.json");
}

export function saveE2ESession(data: SavedE2ESession): void {
  const dir = path.dirname(sessionArtifactPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionArtifactPath(), JSON.stringify(data, null, 2), "utf8");
}

export function loadE2ESession(): SavedE2ESession | null {
  const pth = sessionArtifactPath();
  if (!fs.existsSync(pth)) return null;
  try {
    return JSON.parse(fs.readFileSync(pth, "utf8")) as SavedE2ESession;
  } catch {
    return null;
  }
}

export async function readResultsShortCode(page: Page): Promise<string> {
  const codeLabel = page.locator("span", { hasText: /^Code [A-Z0-9]{8}$/ });
  await expect(codeLabel).toBeVisible();
  const codeText = (await codeLabel.innerText()).replace(/^Code\s+/, "").trim();
  expect(codeText).toMatch(/^[A-Z0-9]{8}$/);
  return codeText;
}

/**
 * Click Start diagnostic and wait for /test. Generate can take ~60s with a real LLM.
 * Fails fast if the home-page error banner appears.
 */
export async function startDiagnosticAndWaitForTest(
  page: Page,
  startButtonName: RegExp | string,
): Promise<void> {
  await page.getByRole("button", { name: startButtonName }).click();
  const errorBox = page.locator("p.text-red-700");
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (page.url().includes("/test")) {
      await maskApiKeyInputs(page);
      return;
    }
    if (await errorBox.isVisible().catch(() => false)) {
      const msg = (await errorBox.innerText()).trim();
      throw new Error(`Diagnostic generate failed on home: ${msg}`);
    }
    await page.waitForTimeout(250);
  }
  if (await errorBox.isVisible().catch(() => false)) {
    throw new Error(
      `Diagnostic generate failed on home: ${(await errorBox.innerText()).trim()}`,
    );
  }
  await expect(page).toHaveURL(/\/test/);
}

// ---------------------------------------------------------------------------
// Per-run manifest for surgical global-teardown cleanup (only THIS run's IDs)
// ---------------------------------------------------------------------------

export type RunManifest = {
  sessionIds: string[];
  learnerIds: string[];
  rateKeys: string[];
};

const EMPTY_MANIFEST: RunManifest = {
  sessionIds: [],
  learnerIds: [],
  rateKeys: [],
};

export function runManifestPath(): string {
  return path.join(process.cwd(), "e2e-artifacts", "run-manifest.json");
}

function withManifestLock<T>(fn: () => T): T {
  const dir = path.dirname(runManifestPath());
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, "run-manifest.lock");
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        return fn();
      } finally {
        fs.closeSync(fd);
        fs.unlinkSync(lockPath);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST" || Date.now() > deadline) {
        // Stale lock recovery if expired
        if (code === "EEXIST") {
          try {
            fs.unlinkSync(lockPath);
            continue;
          } catch {
            // fall through
          }
        }
        throw err;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
}

export function resetRunManifest(): void {
  withManifestLock(() => {
    fs.writeFileSync(
      runManifestPath(),
      JSON.stringify(EMPTY_MANIFEST, null, 2),
      "utf8",
    );
  });
}

export function readRunManifest(): RunManifest {
  const p = runManifestPath();
  if (!fs.existsSync(p)) return { ...EMPTY_MANIFEST };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<RunManifest>;
    return {
      sessionIds: Array.isArray(parsed.sessionIds) ? parsed.sessionIds : [],
      learnerIds: Array.isArray(parsed.learnerIds) ? parsed.learnerIds : [],
      rateKeys: Array.isArray(parsed.rateKeys) ? parsed.rateKeys : [],
    };
  } catch {
    return { ...EMPTY_MANIFEST };
  }
}

export function clearRunManifest(): void {
  const p = runManifestPath();
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}

function appendManifestEntry(kind: keyof RunManifest, value: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  withManifestLock(() => {
    const cur = readRunManifest();
    if (!cur[kind].includes(trimmed)) {
      cur[kind].push(trimmed);
      fs.writeFileSync(runManifestPath(), JSON.stringify(cur, null, 2), "utf8");
    }
  });
}

export function trackCreatedSession(sessionId: string): void {
  appendManifestEntry("sessionIds", sessionId);
}

export function trackCreatedLearner(learnerId: string): void {
  appendManifestEntry("learnerIds", learnerId);
}

export function trackCreatedRateKey(rateKey: string): void {
  appendManifestEntry("rateKeys", rateKey);
}

// ---------------------------------------------------------------------------
// Ephemeral local Next.js & TCP blackhole servers (for isolated feature specs)
// ---------------------------------------------------------------------------

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/** Accept TCP connections and never write anything — simulates a hung Postgres endpoint. */
export async function startBlackholeTcpServer(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const sockets = new Set<net.Socket>();
  const srv = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
  });
  await new Promise<void>((resolve, reject) => {
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = srv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    port,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    },
  };
}

/**
 * Start an isolated `next start` instance (requires `.next` already built)
 * with clean DB/OpenAI env vars plus overrides. Used to test server-test-key
 * flags and hung-DB fail-fast 503s without touching prod or real OpenAI.
 */
export async function startEphemeralAppServer(
  envOverrides: Record<string, string>,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const port = await getFreePort();
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
    throw new Error(".next/BUILD_ID missing — run `npm run build` before starting ephemeral Next server.");
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "production",
  };
  // Safe baseline isolation
  env.DATABASE_URL = "";
  env.POSTGRES_URL = "";
  env.POSTGRES_PRISMA_URL = "";
  env.POSTGRES_URL_NON_POOLING = "";
  env.BLOB_READ_WRITE_TOKEN = "";
  env.OPENAI_API_KEY = "";
  env.XAI_API_KEY = "";
  env.ALLOW_SERVER_TEST_KEY = "";
  env.ALLOW_SERVER_KEY_FALLBACK = "";
  env.LLM_BASE_URL = "http://127.0.0.1:1/v1";
  Object.assign(env, envOverrides);

  const child: ChildProcess = spawn(
    process.execPath,
    [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let logs = "";
  child.stdout?.on("data", (d: Buffer) => {
    logs += d.toString("utf8").slice(-2000);
  });
  child.stderr?.on("data", (d: Buffer) => {
    logs += d.toString("utf8").slice(-2000);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Ephemeral next start exited early (${child.exitCode}): ${logs}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/config`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!ready) {
    child.kill("SIGKILL");
    throw new Error(`Ephemeral next start timed out on ${baseUrl}: ${logs}`);
  }

  return {
    baseUrl,
    close: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3_000);
        child.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}
