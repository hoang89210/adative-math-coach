import fs from "fs";
import readline from "readline";

export async function readJsonlFirstLine<T = unknown>(
  filePath: string,
): Promise<T | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      return JSON.parse(trimmed) as T;
    }
    return null;
  } finally {
    rl.close();
    stream.destroy();
  }
}

export async function* iterateJsonl<T = unknown>(
  filePath: string,
): AsyncGenerator<T> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed) as T;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}
