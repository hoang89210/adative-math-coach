import fs from "node:fs";
import path from "node:path";

function walk(dir: string, acc: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
}

/**
 * Delete any Playwright artifact that accidentally captured OPENAI_API_KEY.
 * Never logs the key or file contents.
 */
export default async function globalTeardown() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return;
  const files: string[] = [];
  walk(path.join(process.cwd(), "test-results"), files);
  walk(path.join(process.cwd(), "playwright-report"), files);
  let n = 0;
  for (const f of files) {
    try {
      const data = fs.readFileSync(f);
      if (data.includes(key)) {
        fs.unlinkSync(f);
        n += 1;
      }
    } catch {
      // ignore
    }
  }
  if (n) {
    console.log(`[e2e] scrubbed ${n} artifact file(s) that contained a secret`);
  }
}
