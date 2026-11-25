import { expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/** Real write / OpenAI flows stay skipped unless RUN_E2E=1. */
export function shouldRunE2E(): boolean {
  return process.env.RUN_E2E === "1";
}

/** Thọ hardening checks (okContent/okDb/dbError, PIN rate-limit). */
export function shouldRunHardening(): boolean {
  return process.env.RUN_HARDENING === "1";
}

export type HealthBody = {
  ok?: boolean;
  okContent?: boolean;
  okDb?: boolean | null;
  dbError?: string;
  env?: {
    hasOpenAiKey?: boolean;
    hasXaiKey?: boolean;
    acceptsUserApiKey?: boolean;
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
  const secretish = /api[_-]?key|password|secret|token|authorization|bearer\s+sk-|postgres(?:ql)?:\/\/[^\s]+/i;

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

/** Preconditions for write E2E: health must report dbOk:true. */
export function assertDbReady(body: HealthBody): void {
  const dbOk = dbOkValue(body);
  if (dbOk !== true) {
    throw new Error(
      `Precondition failed: health dbOk is ${String(dbOk)} (need true) before write E2E. ` +
        `Fix Postgres / Supabase first. Redacted health: ${JSON.stringify(redactHealth(body))}`,
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

export async function fillApiKeyPanel(page: Page, compact = false): Promise<void> {
  const key = readOpenAiKeyFromEnv();
  const input = page.getByPlaceholder(/sk-proj-\.\.\. or sk-\.\.\.|sk-\.\.\./);
  await expect(input).toBeVisible();
  await input.fill(key);
  await page.getByRole("button", { name: compact ? "Save" : "Save key" }).click();
  if (compact) {
    await expect(page.getByText("OpenAI key on device")).toBeVisible();
  } else {
    await expect(page.getByText("Key saved on this device")).toBeVisible();
  }
  // Do not assert, screenshot, or log the key value.
}

const GRADE_MATRIX: Record<
  string,
  { band: string; button: string }
> = {
  K: { band: "K–2", button: "Kindergarten" },
  "4": { band: "3–5", button: "Grade 4" },
  "8": { band: "6–8", button: "Grade 8" },
  "10": { band: "9–12", button: "Grade 10" },
};

export async function selectGrade(page: Page, grade: "K" | "4" | "8" | "10"): Promise<void> {
  const cfg = GRADE_MATRIX[grade];
  await page.getByRole("button", { name: cfg.band, exact: true }).click();
  await page.getByRole("button", { name: cfg.button, exact: true }).click();
}

/** Answer the current diagnostic item, then advance (Next / Submit). */
export async function answerCurrentQuestionAndAdvance(page: Page): Promise<void> {
  const option = page.locator("div.rounded-2xl button[type='button']").first();
  const typed = page.getByPlaceholder("Type your answer");
  if (await option.count()) {
    await option.click();
  } else if (await typed.count()) {
    await typed.fill("42");
  } else {
    throw new Error("TODO: no known answer control found on diagnostic question");
  }
  await page.getByRole("button", { name: /^(Next|Submit)$/ }).click();
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
  return path.join(process.cwd(), "test-results", "e2e-prod-session.json");
}

export function saveE2ESession(data: SavedE2ESession): void {
  const dir = path.dirname(sessionArtifactPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionArtifactPath(), JSON.stringify(data, null, 2), "utf8");
}

export function loadE2ESession(): SavedE2ESession | null {
  const p = sessionArtifactPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as SavedE2ESession;
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

/** Answer every remaining diagnostic question and wait for /results. */
export async function finishDiagnosticAndWaitForResults(page: Page): Promise<void> {
  for (let i = 0; i < 8; i++) {
    if (page.url().includes("/results")) break;
    if (await page.getByRole("heading", { name: /You scored / }).count()) break;
    await expect(page.getByText(/Question \d+ of \d+/)).toBeVisible();
    await answerCurrentQuestionAndAdvance(page);
  }
  await expect(page).toHaveURL(/\/results/, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: /You scored / })).toBeVisible();
}
