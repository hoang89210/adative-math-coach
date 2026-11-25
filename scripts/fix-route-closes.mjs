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
  let s = fs.readFileSync(f, "utf8").replace(/\s+$/, "");
  if (!s.includes("withLlmRequestKey")) continue;
  // Ends with });  but needs });\n}
  if (s.endsWith("});")) {
    s = s + "\n}\n";
    fs.writeFileSync(f, s);
    console.log("appended }", f);
  } else if (s.endsWith("}\n}")) {
    console.log("already ok", f);
  } else {
    console.log("check manually", f, JSON.stringify(s.slice(-20)));
  }
}
