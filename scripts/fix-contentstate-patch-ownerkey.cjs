// scripts/fix-contentstate-patch-ownerkey.cjs
// Fix TS error: 'ownerKey' does not exist in type 'ContentState' inside writeState()/patch logic.
// Remove `ownerKey,` from the object being written in lib/contentState.ts.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-contentstate-patch-ownerkey.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "lib", "contentState.ts");
if (!fs.existsSync(filePath)) {
  console.error("[fix-contentstate-patch-ownerkey] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// Remove any line that is exactly `ownerKey,` within an object literal (best-effort).
const re = /^\s*ownerKey\s*,\s*\r?\n/mg;

let n = 0;
s = s.replace(re, () => {
  n++;
  return "";
});

if (n === 0) {
  console.log("[fix-contentstate-patch-ownerkey] No `ownerKey,` lines found. No changes made.");
  process.exit(0);
}

fs.writeFileSync(filePath, s, "utf8");
console.log(`[fix-contentstate-patch-ownerkey] Removed ${n} ownerKey line(s) from: ${filePath}`);
