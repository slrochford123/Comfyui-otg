// scripts/patch-gallery-status.cjs
// Patches app/app/gallery/page.tsx to be compatible with both status models:
// - backend: "done"
// - legacy UI: "ready"
//
// IMPORTANT: This script expects your real gallery page file to be intact.
// If it was overwritten by a previous bad patch, restore it first (see README).
//
// It replaces patterns like:
//   if (!resp?.file || resp.status !== "done") return;
// or:
//   if (!resp?.file || resp?.status !== "done") return;
//
// with:
//   const isDone = resp?.status === "done" || resp?.status === "ready";
//   if (!resp?.file || !isDone) return;

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "gallery", "page.tsx");
if (!fs.existsSync(filePath)) {
  console.error("[patch-gallery-status] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

const re = /if\s*\(\s*!resp\?\.\s*file\s*\|\|\s*resp\??\.\s*status\s*!==\s*["']done["']\s*\)\s*return\s*;\s*/g;

let n = 0;
s = s.replace(re, () => {
  n++;
  return 'const isDone = resp?.status === "done" || resp?.status === "ready";\n    if (!resp?.file || !isDone) return;\n    ';
});

if (n === 0) {
  console.error('[patch-gallery-status] No matching guard found to patch. Search manually for `resp.status !== "done"`.');
  process.exit(1);
}

fs.writeFileSync(filePath, s, "utf8");
console.log(`[patch-gallery-status] Patched ${n} occurrence(s) in: ${filePath}`);
