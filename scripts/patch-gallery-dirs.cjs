// scripts/patch-gallery-dirs.cjs
// Fix build error: app/api/content/gallery/route.ts uses `dirs.userPreviewDir` but `dirs` is undefined.
// This script inserts `const dirs = getOwnerDirs(ownerKey);` after ownerKey is computed.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/patch-gallery-dirs.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "api", "content", "gallery", "route.ts");
if (!fs.existsSync(filePath)) {
  console.error("[patch-gallery-dirs] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// If already fixed
if (s.includes("const dirs = getOwnerDirs(ownerKey)")) {
  console.log("[patch-gallery-dirs] Already patched. No changes made.");
  process.exit(0);
}

// We need getOwnerDirs imported; if not, fail with hint.
if (!s.includes("getOwnerDirs")) {
  console.error("[patch-gallery-dirs] getOwnerDirs not referenced/imported in this file. Please ensure it imports getOwnerDirs from '@/lib/paths'.");
  process.exit(1);
}

// Find a good insertion point: after ownerKey is set.
// Common patterns:
//   const ownerKey = owner.ownerKey;
// or
//   const ownerKey = ctx.ownerKey;
// or
//   const ownerKey = owner.ownerKey || "local";
const ownerKeyLineRe = /const\s+ownerKey\s*=\s*[^;]+;\s*\r?\n/;

const m = s.match(ownerKeyLineRe);
if (!m) {
  console.error("[patch-gallery-dirs] Could not find `const ownerKey = ...;` line to insert after.");
  process.exit(1);
}

s = s.replace(ownerKeyLineRe, (line) => {
  return line + '  const dirs = getOwnerDirs(ownerKey);\n';
});

fs.writeFileSync(filePath, s, "utf8");
console.log("[patch-gallery-dirs] Inserted `const dirs = getOwnerDirs(ownerKey);` in:", filePath);
