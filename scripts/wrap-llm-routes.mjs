import fs from "fs";

const files = [
  "src/app/api/diagnostic/generate/route.ts",
  "src/app/api/roadmap/route.ts",
  "src/app/api/practice/generate/route.ts",
  "src/app/api/study-sheet/generate/route.ts",
  "src/app/api/cfu/generate/route.ts",
  "src/app/api/differentiate/generate/route.ts",
  "src/app/api/teacher/lesson/generate/route.ts",
  "src/app/api/teacher/prep/route.ts",
  "src/app/api/teacher/cfu-guide/route.ts",
  "src/app/api/lab/evaluate/math-alignment/route.ts",
  "src/app/api/lab/evaluate/grade-level/route.ts",
];

for (const f of files) {
  let s = fs.readFileSync(f, "utf8");
  if (s.includes("withLlmRequestKey(request")) {
    console.log("already wrapped", f);
    continue;
  }

  if (s.includes('from "@/lib/llm"')) {
    s = s.replace(
      /import \{([^}]+)\} from "@\/lib\/llm";/,
      (_, inner) => {
        const parts = inner
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        if (!parts.includes("withLlmRequestKey")) parts.push("withLlmRequestKey");
        return `import { ${parts.join(", ")} } from "@/lib/llm";`;
      },
    );
  } else {
    s = `import { withLlmRequestKey } from "@/lib/llm";\n` + s;
  }

  for (const method of ["POST", "GET"]) {
    const sig = `export async function ${method}(request: NextRequest)`;
    if (!s.includes(sig)) continue;
    s = s.replace(
      `export async function ${method}(request: NextRequest) {\n`,
      `export async function ${method}(request: NextRequest) {\n  return withLlmRequestKey(request, async () => {\n`,
    );
    // Close the wrapper: the function ends with final }
    // Find the last occurrence of export async function and balance braces from there
  }

  // Brace-balance close for each method we opened
  // Simpler approach: replace trailing structure
  // After wrap, the outer function needs `});` before final `}`
  // Count: we added `return withLlmRequestKey(request, async () => {` 
  // so before the last `}` of the file's export function we need `});`

  // Parse from each export async function METHOD
  const lines = s.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    const m = line.match(
      /^export async function (POST|GET)\(request: NextRequest\) \{\s*$/,
    );
    if (m && lines[i + 1]?.includes("return withLlmRequestKey")) {
      // already have next line as return with...
      i++;
      out.push(lines[i]); // return withLlmRequestKey line
      i++;
      // copy until brace balance from the withLlm line's async () => {
      // Start depth: function { =1, then return withLlmRequestKey(..., async () => { = +1 more inside
      let depth = 1; // outer function already opened
      // the return line opened another {
      depth += 1;
      while (i < lines.length) {
        const L = lines[i];
        for (const ch of L) {
          if (ch === "{") depth++;
          if (ch === "}") depth--;
        }
        if (depth === 1) {
          // this line closed the async callback; should be a lone }
          // replace with }); to close withLlmRequestKey call
          const closed = L.replace(/\}(\s*)$/, "});$1");
          out.push(closed);
          i++;
          break;
        }
        out.push(L);
        i++;
      }
      continue;
    }
    i++;
  }
  s = out.join("\n");
  fs.writeFileSync(f, s);
  console.log("wrapped", f);
}
