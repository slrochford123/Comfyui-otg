// scripts/fix-page-tsx-v4.cjs
// Robust parser-balance hotfix for app/app/page.tsx build error:
//   Expected ';', got 'GalleryFile' at `type GalleryFile = ...`
//
// Strategy:
// - Find the first `type GalleryFile` declaration.
// - Look backwards to find the last `type ContentState` (or any `type ... = {` block) before it.
// - Compute a crude `{`/`}` balance between that start and `type GalleryFile`.
// - If balance > 0, we are still inside a type literal => insert a closing `};` right before `type GalleryFile`.
// - Else, do nothing.
//
// Usage (from project root):
//   node scripts/fix-page-tsx-v4.cjs

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "page.tsx");
if (!fs.existsSync(filePath)) {
  console.error("[fix-page-tsx-v4] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

const galleryIdx = s.search(/\btype\s+GalleryFile\b/);
if (galleryIdx < 0) {
  console.log("[fix-page-tsx-v4] `type GalleryFile` not found. No changes made.");
  process.exit(0);
}

// Find a reasonable block start to balance from.
// Prefer `type ContentState = {` if present, else the last `type <Name> = {` before GalleryFile.
let startIdx = s.lastIndexOf("type ContentState", galleryIdx);
if (startIdx < 0) {
  const m = [...s.slice(0, galleryIdx).matchAll(/\btype\s+\w+\s*=\s*\{/g)];
  if (m.length) startIdx = m[m.length - 1].index;
}
if (startIdx < 0) {
  console.log("[fix-page-tsx-v4] No preceding `type ... = {` found. No changes made.");
  process.exit(0);
}

// Compute crude brace balance (ignore strings/comments imperfectly; good enough for this small header).
const region = s.slice(startIdx, galleryIdx);
let bal = 0;
for (let i = 0; i < region.length; i++) {
  const ch = region[i];
  if (ch === "{") bal++;
  else if (ch === "}") bal--;
}
if (bal <= 0) {
  // Might still be missing a semicolon after a closing brace right before GalleryFile
  // If the last non-ws char before GalleryFile is `}`, insert `;`
  const before = s.slice(0, galleryIdx).replace(/[ \t\r\n]+$/g, "");
  if (before.endsWith("}") && !before.endsWith("};")) {
    s = before + ";" + s.slice(before.length) ;
    fs.writeFileSync(filePath, s, "utf8");
    console.log("[fix-page-tsx-v4] Inserted missing semicolon after `}` before GalleryFile.");
    process.exit(0);
  }
  console.log("[fix-page-tsx-v4] Brace balance indicates closed. No changes made.");
  process.exit(0);
}

// Insert closing `};` right before GalleryFile
s = s.slice(0, galleryIdx) + "\n};\n\n" + s.slice(galleryIdx);
fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-page-tsx-v4] Inserted `};` before GalleryFile to close an unterminated type block.");
