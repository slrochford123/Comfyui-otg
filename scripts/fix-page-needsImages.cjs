// scripts/fix-page-needsImages.cjs
// Fix TS error: app/app/page.tsx references `needsImages` but it is not declared.
// Inserts `const needsImages = 0;` before the first `return (` inside the main page component,
// but only if needsImages isn't already declared.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-page-needsImages.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "page.tsx");
if (!fs.existsSync(filePath)) {
  console.error("[fix-page-needsImages] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

if (/\b(const|let|var)\s+needsImages\b/.test(s)) {
  console.log("[fix-page-needsImages] needsImages already declared. No changes made.");
  process.exit(0);
}

if (!s.includes("{needsImages")) {
  console.error("[fix-page-needsImages] No `{needsImages` usage found. Nothing to patch.");
  process.exit(1);
}

const idx = s.indexOf("return (");
if (idx === -1) {
  console.error("[fix-page-needsImages] Could not find `return (` in page.tsx.");
  process.exit(1);
}

const lineStart = s.lastIndexOf("\n", idx) + 1;
const lineEnd = s.indexOf("\n", lineStart);
const line = s.slice(lineStart, lineEnd === -1 ? s.length : lineEnd);
const indent = (line.match(/^\s*/) || [""])[0];

const insert = `${indent}const needsImages = 0;\n`;

s = s.slice(0, lineStart) + insert + s.slice(lineStart);

fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-page-needsImages] Inserted `const needsImages = 0;` before first return in:", filePath);
