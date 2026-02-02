// scripts/fix-contentstate-reset-empty-to-idle.cjs
// Fix TS error: resetState() still sets status: "empty".
// Replace with status: "idle" in lib/contentState.ts.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-contentstate-reset-empty-to-idle.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "lib", "contentState.ts");
if (!fs.existsSync(filePath)) {
  console.error("[fix-contentstate-reset-empty-to-idle] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// specifically replace within resetState writeState patch, but simple global replace is safe now
let n = 0;
s = s.replace(/status:\s*["']empty["']/g, (m) => {
  n++;
  return 'status: "idle"';
});

if (n === 0) {
  console.log("[fix-contentstate-reset-empty-to-idle] No status:"empty" found. No changes made.");
  process.exit(0);
}

fs.writeFileSync(filePath, s, "utf8");
console.log(`[fix-contentstate-reset-empty-to-idle] Replaced ${n} occurrence(s) in: ${filePath}`);
