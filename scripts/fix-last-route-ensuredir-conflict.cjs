// scripts/fix-last-route-ensuredir-conflict.cjs
// Fix TS error: Import declaration conflicts with local declaration of 'ensureDir'.
// app/api/content/last/route.ts defines a local ensureDir() helper, so we must NOT import ensureDir from "@/lib/paths".
//
// Patch: remove `ensureDir` from the named import list from "@/lib/paths".
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-last-route-ensuredir-conflict.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "api", "content", "last", "route.ts");
if (!fs.existsSync(filePath)) {
  console.error("[fix-last-route-ensuredir-conflict] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// Find the import from "@/lib/paths" and remove ensureDir from the list
const re = /^import\s*\{\s*([^}]+)\s*\}\s*from\s*["']@\/lib\/paths["'];\s*\r?\n/m;

const m = s.match(re);
if (!m) {
  console.error("[fix-last-route-ensuredir-conflict] Could not find import from '@/lib/paths'.");
  process.exit(1);
}

let inner = m[1];

// Remove ensureDir (with optional commas/spaces)
inner = inner
  .replace(/\bensureDir\b\s*,?/g, "")
  .replace(/,\s*,/g, ",")
  .replace(/^\s*,\s*/g, "")
  .replace(/\s*,\s*$/g, "")
  .replace(/\s+/g, " ")
  .trim();

const newLine = `import { ${inner} } from "@/lib/paths";\n`;
s = s.replace(re, newLine);

fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-last-route-ensuredir-conflict] Removed imported ensureDir from:", filePath);
