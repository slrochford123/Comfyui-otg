// scripts/fix-page-tsx-v6.cjs
// Fixes app/app/page.tsx parse error where ContentState fields are floating outside a type,
// causing: "Expression expected" at `updatedAt?: number | null;`
//
// This script:
// 1) Removes any existing `type ContentState = { ... };` block (if present) to avoid duplicates.
// 2) Finds the broken pattern:
//
//    type PreviewFile = {...};
//      favorited: boolean;
//      updatedAt?: ...
//      startedAt?: ...
//      readyAt?: ...
//    };
//
// and replaces it with a valid `type ContentState = { ... };` block.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-page-tsx-v6.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "page.tsx");
if (!fs.existsSync(filePath)) {
  console.error("[fix-page-tsx-v6] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// 1) Remove any existing ContentState block (non-greedy)
s = s.replace(/\btype\s+ContentState\s*=\s*\{[\s\S]*?\n\};\s*\n+/m, "");

// 2) Replace broken floating fields after PreviewFile
const brokenRe = /(\btype\s+PreviewFile\s*=\s*\{[^}]*\};\s*\r?\n)([ \t]*favorited:\s*boolean;\s*\r?\n[ \t]*updatedAt\?:\s*number\s*\|\s*null;\s*\r?\n[ \t]*startedAt\?:\s*number\s*\|\s*null;\s*\r?\n[ \t]*readyAt\?:\s*number\s*\|\s*null;\s*\r?\n[ \t]*\};\s*\r?\n)/m;

if (!brokenRe.test(s)) {
  console.error("[fix-page-tsx-v6] Could not find the broken PreviewFile/ContentState pattern. Please paste the first ~70 lines of app/app/page.tsx.");
  process.exit(1);
}

s = s.replace(brokenRe, (_all, previewLine) => {
  return (
    previewLine +
    "\n" +
    "type ContentState = {\n" +
    '  status: "idle" | "running" | "ready" | "error";\n' +
    "  file: PreviewFile | null;\n" +
    "  favorited: boolean;\n" +
    "  updatedAt?: number | null;\n" +
    "  startedAt?: number | null;\n" +
    "  readyAt?: number | null;\n" +
    "  error?: string | null;\n" +
    "};\n\n"
  );
});

fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-page-tsx-v6] Fixed type declarations in:", filePath);
