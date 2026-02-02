// scripts/fix-page-tsx-v3.cjs
// Targeted hotfix for the exact parse error:
//   Expected ';', got 'GalleryFile' at the line `type GalleryFile = ...`
//
// Root cause: the type/interface block immediately above isn't terminated.
// In our codebase this is typically a `type ContentState = { ... favorited: boolean;`
// missing its closing `};`.
//
// This script:
// 1) Finds `favorited: boolean;` followed soon after by `type GalleryFile`
// 2) Ensures there is a `};` between them (inserts if missing)

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "page.tsx");
if (!fs.existsSync(filePath)) {
  console.error("[fix-page-tsx-v3] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// Match favorited boolean and the next GalleryFile type
const re = /(favorited:\s*boolean;\s*\r?\n)([\s\r\n]*)(type\s+GalleryFile\s*=\s*\{)/m;
const m = s.match(re);

if (!m) {
  console.log("[fix-page-tsx-v3] Could not find `favorited: boolean;` followed by `type GalleryFile`. No changes made.");
  process.exit(0);
}

const beforeGallery = s.slice(0, s.indexOf(m[3], s.indexOf(m[1])));

// If `};` already exists in the whitespace gap, do nothing
const gap = m[2] || "";
if (gap.includes("};")) {
  console.log("[fix-page-tsx-v3] `};` already present between favorited and GalleryFile. No changes made.");
  process.exit(0);
}

// Also handle case where there is a `}` but no `;`
if (gap.includes("}")) {
  // replace the first standalone closing brace with `};`
  const fixedGap = gap.replace(/^\s*\}\s*(\r?\n)/m, "};$1");
  s = s.replace(re, (_all, g1, _g2, g3) => `${g1}${fixedGap}${g3}`);
  fs.writeFileSync(filePath, s, "utf8");
  console.log("[fix-page-tsx-v3] Replaced stray `}` with `};` before GalleryFile.");
  process.exit(0);
}

// Insert `};` after favorited line
s = s.replace(re, (_all, g1, g2, g3) => `${g1}\n};\n\n${g3}`);
fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-page-tsx-v3] Inserted missing `};` before GalleryFile.");
