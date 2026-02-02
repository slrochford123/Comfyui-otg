// scripts/patch-gallery-dirs-v2.cjs
// Robust fix: ensure `dirs` is defined before first use in app/api/content/gallery/route.ts
// Inserts: `const dirs = getOwnerDirs(ownerKey);` immediately before the first `dirs.userPreviewDir` reference.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/patch-gallery-dirs-v2.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "api", "content", "gallery", "route.ts");
if (!fs.existsSync(filePath)) {
  console.error("[patch-gallery-dirs-v2] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

if (s.includes("const dirs = getOwnerDirs(ownerKey);")) {
  console.log("[patch-gallery-dirs-v2] Already patched. No changes made.");
  process.exit(0);
}

const marker = "dirs.userPreviewDir";
const idx = s.indexOf(marker);
if (idx === -1) {
  console.error("[patch-gallery-dirs-v2] Could not find `dirs.userPreviewDir` in route.ts.");
  process.exit(1);
}

// Find start of the line containing dirs.userPreviewDir
const lineStart = s.lastIndexOf("\n", idx) + 1;

// Insert dirs declaration right before that line, with same indentation as that line
const line = s.slice(lineStart, s.indexOf("\n", lineStart));
const indent = (line.match(/^\s*/) || [""])[0];

const insert = `${indent}const dirs = getOwnerDirs(ownerKey);\n`;

s = s.slice(0, lineStart) + insert + s.slice(lineStart);

fs.writeFileSync(filePath, s, "utf8");
console.log("[patch-gallery-dirs-v2] Inserted dirs declaration before first use in:", filePath);
