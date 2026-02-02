// scripts/fix-studio-status-union.cjs
// Fix TS mismatch between legacy UI status union ("empty"|"running"|"ready")
// and backend/contentState union ("idle"|"running"|"done"|"error").
//
// Applies to: app/app/page.tsx
//
// Changes:
// 1) Expands LastContent.status union to include BOTH sets.
// 2) Updates the polling stop condition to stop on done/ready/idle/error/empty.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-studio-status-union.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "page.tsx");
if (!fs.existsSync(filePath)) {
  console.error("[fix-studio-status-union] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// 1) Expand union on `status: "empty" | "running" | "ready"` (with or without spaces/newlines)
const unionFromRe = /status\s*:\s*["']empty["']\s*\|\s*["']running["']\s*\|\s*["']ready["']/m;
const unionTo = 'status: "empty" | "idle" | "running" | "ready" | "done" | "error"';

if (unionFromRe.test(s)) {
  s = s.replace(unionFromRe, unionTo);
  console.log("[fix-studio-status-union] Expanded LastContent.status union.");
} else {
  console.log("[fix-studio-status-union] Union pattern not found (may already be expanded).");
}

// 2) Patch stopPoll condition
const stopFromRe = /if\s*\(\s*res\.status\s*===\s*["']done["']\s*\|\|\s*res\.status\s*===\s*["']empty["']\s*\)\s*\{/m;
const stopTo = 'if (res.status === "done" || res.status === "ready" || res.status === "idle" || res.status === "error" || res.status === "empty") {';

if (stopFromRe.test(s)) {
  s = s.replace(stopFromRe, stopTo);
  console.log("[fix-studio-status-union] Patched poll stop condition.");
} else {
  console.log("[fix-studio-status-union] Stop condition pattern not found (may differ).");
}

fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-studio-status-union] Wrote:", filePath);
