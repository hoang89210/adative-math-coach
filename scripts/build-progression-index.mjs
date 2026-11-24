import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const relationshipsPath = path.resolve(root, "..", "data", "relationships.jsonl");
const outPath = path.join(root, "data", "progression-index.json");

async function* iterateJsonl(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

async function main() {
  const buildsTowards = {};
  const prerequisitesOf = {};
  let edgeCount = 0;

  for await (const rel of iterateJsonl(relationshipsPath)) {
    if (rel.label !== "buildsTowards") continue;
    const s = rel.source_identifier;
    const t = rel.target_identifier;
    if (!s || !t) continue;
    if (!buildsTowards[s]) buildsTowards[s] = [];
    buildsTowards[s].push(t);
    if (!prerequisitesOf[t]) prerequisitesOf[t] = [];
    prerequisitesOf[t].push(s);
    edgeCount += 1;
  }

  const payload = {
    builtAt: new Date().toISOString(),
    edgeCount,
    buildsTowards,
    prerequisitesOf,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log(`Wrote ${outPath} edges=${edgeCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
