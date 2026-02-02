// scripts/fix-paths-add-previewdir.cjs
// Fix TS error: 'userPreviewDir' does not exist in type 'OwnerDirs'.
// Adds `userPreviewDir: string;` to the OwnerDirs type in lib/paths.ts.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-paths-add-previewdir.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "lib", "paths.ts");
if (!fs.existsSync(filePath)) {
  console.error("[fix-paths-add-previewdir] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// If already present, exit
if (s.includes("userPreviewDir")) {
  console.log("[fix-paths-add-previewdir] userPreviewDir already present. No changes made.");
  process.exit(0);
}

// Try to find OwnerDirs type/interface block
// Common patterns:
// export type OwnerDirs = { ... }
// export interface OwnerDirs { ... }
let changed = false;

// Pattern A: type OwnerDirs = { ... userFavoritesDir: ... }
const typeBlockRe = /export\s+type\s+OwnerDirs\s*=\s*\{([\s\S]*?)\n\};/m;
if (typeBlockRe.test(s)) {
  s = s.replace(typeBlockRe, (m, inner) => {
    // insert after userFavoritesDir line if present
    if (/userFavoritesDir\s*:/.test(inner)) {
      const inner2 = inner.replace(/(\n\s*userFavoritesDir\s*:\s*[^;]+;)/, `$1\n  userPreviewDir: string;`);
      changed = true;
      return `export type OwnerDirs = {${inner2}\n};`;
    }
    // else append near end
    changed = true;
    return `export type OwnerDirs = {${inner}\n  userPreviewDir: string;\n};`;
  });
}

// Pattern B: interface OwnerDirs { ... }
if (!changed) {
  const ifaceRe = /export\s+interface\s+OwnerDirs\s*\{([\s\S]*?)\n\}/m;
  if (ifaceRe.test(s)) {
    s = s.replace(ifaceRe, (m, inner) => {
      if (/userFavoritesDir\s*:/.test(inner)) {
        const inner2 = inner.replace(/(\n\s*userFavoritesDir\s*:\s*[^;]+;)/, `$1\n  userPreviewDir: string;`);
        changed = true;
        return `export interface OwnerDirs {${inner2}\n}`;
      }
      changed = true;
      return `export interface OwnerDirs {${inner}\n  userPreviewDir: string;\n}`;
    });
  }
}

if (!changed) {
  console.error("[fix-paths-add-previewdir] Could not locate OwnerDirs type/interface. Please open lib/paths.ts and search for `OwnerDirs`.");
  process.exit(1);
}

fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-paths-add-previewdir] Added userPreviewDir to OwnerDirs in:", filePath);
