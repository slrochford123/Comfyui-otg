// scripts/fix-page-tsx-v8.cjs
const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "page.tsx");
if (!fs.existsSync(filePath)) {
  console.error("[fix-page-tsx-v8] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");
const re = /\blast\?\.\s*favorited\b/g;

if (!re.test(s)) {
  console.log("[fix-page-tsx-v8] No `last?.favorited` occurrences found. No changes made.");
  process.exit(0);
}

s = s.replace(re, "(last as any)?.favorited");
fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-page-tsx-v8] Patched `last?.favorited` -> `(last as any)?.favorited` in:", filePath);
