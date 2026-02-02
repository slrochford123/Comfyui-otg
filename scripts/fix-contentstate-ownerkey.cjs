// scripts/fix-contentstate-ownerkey.cjs
// Fix TS error: 'ownerKey' does not exist in type 'ContentState'.
// Patch lib/contentState.ts default object in readState() to remove `ownerKey,`.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-contentstate-ownerkey.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "lib", "contentState.ts");
if (!fs.existsSync(filePath)) {
  console.error("[fix-contentstate-ownerkey] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// Remove a line containing just `ownerKey,` (with optional spaces)
const re = /^\s*ownerKey\s*,\s*\r?\n/m;

if (!re.test(s)) {
  console.log("[fix-contentstate-ownerkey] No `ownerKey,` default field found. No changes made.");
  process.exit(0);
}

s = s.replace(re, "");
fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-contentstate-ownerkey] Removed default `ownerKey,` from:", filePath);
