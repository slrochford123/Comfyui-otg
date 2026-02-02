// scripts/fix-last-route-libfs.cjs
// Fix build error: app/api/content/last/route.ts imports ensureDir from "@/lib/fs" which doesn't exist.
// Patch to import ensureDir from "@/lib/paths" instead.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-last-route-libfs.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "api", "content", "last", "route.ts");
if (!fs.existsSync(filePath)) {
  console.error("[fix-last-route-libfs] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// Remove import from "@/lib/fs"
s = s.replace(/^\s*import\s*\{\s*ensureDir\s*\}\s*from\s*["']@\/lib\/fs["'];\s*\r?\n/m, "");

// Ensure ensureDir is imported from "@/lib/paths"
const pathsImportRe = /^import\s*\{([^}]+)\}\s*from\s*["']@\/lib\/paths["'];\s*\r?\n/m;
if (pathsImportRe.test(s)) {
  s = s.replace(pathsImportRe, (m, inner) => {
    if (inner.includes("ensureDir")) return m;
    // add ensureDir to the named imports
    return m.replace(inner, inner.trim() + ", ensureDir ");
  });
} else {
  console.error("[fix-last-route-libfs] Could not find import from '@/lib/paths' to add ensureDir.");
  process.exit(1);
}

fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-last-route-libfs] Patched:", filePath);
