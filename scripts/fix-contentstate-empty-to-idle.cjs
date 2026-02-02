// scripts/fix-contentstate-empty-to-idle.cjs
// Fix TS error: ContentStateStatus no longer includes "empty".
// Patch lib/contentState.ts default status from "empty" -> "idle".
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-contentstate-empty-to-idle.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "lib", "contentState.ts");
if (!fs.existsSync(filePath)) {
  console.error("[fix-contentstate-empty-to-idle] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

const from = 'status: "empty"';
const to = 'status: "idle"';

if (s.includes(to)) {
  console.log("[fix-contentstate-empty-to-idle] Already patched. No changes made.");
  process.exit(0);
}

if (!s.includes(from)) {
  console.error('[fix-contentstate-empty-to-idle] Pattern not found. Search for `status: "empty"` in lib/contentState.ts.');
  process.exit(1);
}

s = s.replace(from, to);
fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-contentstate-empty-to-idle] Patched:", filePath);
