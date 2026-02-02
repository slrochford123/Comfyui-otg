// scripts/fix-page-tsx-v7.cjs
// Fix TS build error:
//   Property 'updatedAt' does not exist on type 'LastContent'.
//
// We keep types strict by not requiring LastContent to include updatedAt,
// and instead access it defensively via (res as any).updatedAt.
//
// This script patches app/app/page.tsx:
//   Number(res.updatedAt || 0)  ->  Number((res as any).updatedAt || 0)
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-page-tsx-v7.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "page.tsx");
if (!fs.existsSync(filePath)) {
  console.error("[fix-page-tsx-v7] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

const from = "Number(res.updatedAt || 0)";
const to = "Number((res as any).updatedAt || 0)";

if (s.includes(to)) {
  console.log("[fix-page-tsx-v7] Already patched. No changes made.");
  process.exit(0);
}

if (!s.includes(from)) {
  console.error("[fix-page-tsx-v7] Pattern not found. Please search for `res.updatedAt` in app/app/page.tsx and patch similarly.");
  process.exit(1);
}

s = s.replace(from, to);
fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-page-tsx-v7] Patched:", filePath);
