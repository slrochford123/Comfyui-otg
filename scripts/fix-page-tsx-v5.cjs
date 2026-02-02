// scripts/fix-page-tsx-v5.cjs
// Fix app/app/page.tsx header type declarations.
// Current file has a broken type block causing:
//  - Expected ';', got 'GalleryFile'
//  - Expression expected near `updatedAt?: number | null;`
//
// This script rewrites the type declarations section (ContentState/GalleryFile/PreviewFile)
// in a deterministic way, without touching the React component below.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-page-tsx-v5.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "page.tsx");
if (!fs.existsSync(filePath)) {
  console.error("[fix-page-tsx-v5] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

const csIdx = s.search(/\btype\s+ContentState\b/);
const gfIdx = s.search(/\btype\s+GalleryFile\b/);
const pfIdx = s.search(/\btype\s+PreviewFile\b/);

if (csIdx < 0 || gfIdx < 0 || pfIdx < 0) {
  console.error("[fix-page-tsx-v5] Could not locate required type declarations. Aborting.");
  process.exit(1);
}

// Find the end of the broken type section: the first line that is exactly `};` after PreviewFile.
const afterPf = s.slice(pfIdx);
const endMatch = afterPf.match(/\r?\n\};\r?\n/);
if (!endMatch) {
  console.error("[fix-page-tsx-v5] Could not find closing `};` after PreviewFile. Aborting.");
  process.exit(1);
}
const endIdx = pfIdx + endMatch.index + endMatch[0].length; // includes the closing line + newline

const replacement = `
type PreviewFile = { name: string; kind: "image" | "video"; url: string };

type ContentState = {
  status: "idle" | "running" | "ready" | "error";
  file: PreviewFile | null;
  favorited: boolean;
  updatedAt?: number | null;
  startedAt?: number | null;
  readyAt?: number | null;
  error?: string | null;
};

type GalleryFile = { name: string; ts?: number; size?: number; url: string };
`.trim() + "\n\n";

// Replace from ContentState start through endIdx with canonical block.
// Note: We intentionally place PreviewFile first because ContentState references it.
s = s.slice(0, csIdx) + replacement + s.slice(endIdx);

fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-page-tsx-v5] Rewrote type declarations in:", filePath);
