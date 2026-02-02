// scripts/fix-page-tsx.cjs
// Hotfix: patch app/app/page.tsx syntax error introduced by last zip.
// It inserts a missing closing `};` before `type GalleryFile = ...` if needed.

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "page.tsx");

if (!fs.existsSync(filePath)) {
  console.error("[fix-page-tsx] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// Detect the exact broken pattern: `favorited: boolean;` followed by `type GalleryFile`
const pat = /(favorited:\s*boolean;\s*\r?\n)(\s*\r?\n)*(type\s+GalleryFile\s*=\s*\{)/m;

if (pat.test(s)) {
  // If the block already closes with `};` between favorited and type GalleryFile, do nothing.
  const betweenPat = /(favorited:\s*boolean;[\s\S]{0,200}?)(\r?\n\s*\};\s*\r?\n[\s\S]{0,50}?type\s+GalleryFile)/m;
  if (betweenPat.test(s)) {
    console.log("[fix-page-tsx] Looks already fixed. No changes made.");
    process.exit(0);
  }

  s = s.replace(pat, (_m, g1, _g2, g3) => `${g1}\n};\n\n${g3}`);
  fs.writeFileSync(filePath, s, "utf8");
  console.log("[fix-page-tsx] Patched:", filePath);
  process.exit(0);
}

console.log("[fix-page-tsx] Pattern not found. No changes made.");
process.exit(0);
