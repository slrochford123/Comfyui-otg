// scripts/fix-page-needsImages-v2.cjs
// Robust fix: declare `needsImages` inside the main page component scope.
// Inserts `const needsImages = 0;` right after `export default function ... {`
// (or after `function ... {` if default export isn't found).
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-page-needsImages-v2.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "page.tsx");
if (!fs.existsSync(filePath)) {
  console.error("[fix-page-needsImages-v2] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

if (/\b(const|let|var)\s+needsImages\b/.test(s)) {
  console.log("[fix-page-needsImages-v2] needsImages already declared. No changes made.");
  process.exit(0);
}

const insertLine = "  const needsImages = 0; // TODO: wire to workflow input slots\n";

// Pattern 1: export default function ...
let re1 = /(export\s+default\s+function\s+[A-Za-z0-9_]*\s*\([^)]*\)\s*\{\s*\r?\n)/m;
if (re1.test(s)) {
  s = s.replace(re1, `$1${insertLine}`);
  fs.writeFileSync(filePath, s, "utf8");
  console.log("[fix-page-needsImages-v2] Inserted needsImages after default export function in:", filePath);
  process.exit(0);
}

// Pattern 2: function ComponentName(...) {
let re2 = /(function\s+[A-Za-z0-9_]+\s*\([^)]*\)\s*\{\s*\r?\n)/m;
if (re2.test(s)) {
  s = s.replace(re2, `$1${insertLine}`);
  fs.writeFileSync(filePath, s, "utf8");
  console.log("[fix-page-needsImages-v2] Inserted needsImages after function declaration in:", filePath);
  process.exit(0);
}

console.error("[fix-page-needsImages-v2] Could not find a function component header to patch. Please locate the main component and add: `const needsImages = 0;` inside it.");
process.exit(1);
