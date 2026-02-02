// scripts/fix-page-tsx-v2.cjs
// Robust hotfix for app/app/page.tsx:
// Ensures there's a closing `};` for the type block immediately before `type GalleryFile = ...`.
// This was causing: "Expected ';', got 'GalleryFile'".
//
// Usage (from project root):
//   node scripts/fix-page-tsx-v2.cjs

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "page.tsx");
if (!fs.existsSync(filePath)) {
  console.error("[fix-page-tsx-v2] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// Find the GalleryFile type declaration
const idx = s.search(/\btype\s+GalleryFile\s*=\s*\{/);
if (idx < 0) {
  console.log("[fix-page-tsx-v2] `type GalleryFile = {` not found. No changes made.");
  process.exit(0);
}

// Look back a bit to see whether there's already a closing `};` right before it
const lookbackStart = Math.max(0, idx - 600);
const before = s.slice(lookbackStart, idx);

// If there is already a `};` in the last ~200 chars, assume it's ok
if (before.slice(-220).match(/\};\s*$/m)) {
  console.log("[fix-page-tsx-v2] Looks already closed before GalleryFile. No changes made.");
  process.exit(0);
}

// If the last non-whitespace before GalleryFile is `}`, we need `;`
if (before.match(/\}\s*$/m)) {
  // Insert `;` after that closing brace
  // Replace the last occurrence of `}` before idx that is followed only by whitespace.
  const patchRegionStart = lookbackStart + before.lastIndexOf("}");
  if (patchRegionStart >= 0) {
    s = s.slice(0, patchRegionStart + 1) + ";" + s.slice(patchRegionStart + 1);
    fs.writeFileSync(filePath, s, "utf8");
    console.log("[fix-page-tsx-v2] Inserted missing semicolon after closing brace before GalleryFile.");
    process.exit(0);
  }
}

// Otherwise, insert a full `};` on its own line right before GalleryFile
s = s.slice(0, idx) + "\n};\n\n" + s.slice(idx);
fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-page-tsx-v2] Inserted missing `};` before GalleryFile.");
