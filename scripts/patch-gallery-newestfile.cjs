#!/usr/bin/env node
/**
 * Patch app/api/content/gallery/route.ts to define newestFileInDir()
 * (and required node:fs/node:path imports) if it's referenced but missing.
 *
 * Usage:
 *   node scripts/patch-gallery-newestfile.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

function die(msg) {
  console.error("[patch-gallery-newestfile] " + msg);
  process.exit(1);
}

const root = process.cwd();
const target = path.join(root, "app", "api", "content", "gallery", "route.ts");
if (!fs.existsSync(target)) die("Target not found: " + target);

let src = fs.readFileSync(target, "utf8");

// Only patch if the file references newestFileInDir( but doesn't already define it.
const uses = src.includes("newestFileInDir(");
const defines = /function\s+newestFileInDir\s*\(/.test(src) || /const\s+newestFileInDir\s*=/.test(src);

if (!uses) {
  console.log("[patch-gallery-newestfile] No newestFileInDir() usage found. No changes made.");
  process.exit(0);
}
if (defines) {
  console.log("[patch-gallery-newestfile] newestFileInDir() already defined. No changes made.");
  process.exit(0);
}

// Ensure imports for fs/path are present (TS file can use ES imports).
// We'll insert them after the first import line (commonly NextResponse).
function ensureImport(spec, from) {
  const line = `import ${spec} from "${from}";`;
  if (src.includes(line)) return;
  // If there is any import from that module already, skip.
  const re = new RegExp(`from\\s+["']${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
  if (re.test(src)) return;
  // Insert after the first import statement.
  const m = src.match(/^(import[^\n]*\n)/m);
  if (!m) {
    src = line + "\n" + src;
    return;
  }
  const idx = m.index + m[0].length;
  src = src.slice(0, idx) + line + "\n" + src.slice(idx);
}

ensureImport("* as fs", "node:fs");
ensureImport("path", "node:path");

const helper = `
function newestFileInDir(dir: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);

    if (!entries.length) return null;

    let best: { name: string; mtime: number } | null = null;
    for (const name of entries) {
      const fp = path.join(dir, name);
      let st: any;
      try {
        st = fs.statSync(fp);
      } catch {
        continue;
      }
      const mtime = Number(st.mtimeMs || 0);
      if (!best || mtime > best.mtime) best = { name, mtime };
    }
    return best ? best.name : null;
  } catch {
    return null;
  }
}
`;

// Insert helper near top, after imports.
const lastImportIdx = (() => {
  let idx = 0;
  const importRe = /^import[^\n]*\n/gm;
  let m;
  while ((m = importRe.exec(src)) !== null) idx = m.index + m[0].length;
  return idx;
})();
src = src.slice(0, lastImportIdx) + "\n" + helper + "\n" + src.slice(lastImportIdx);

fs.writeFileSync(target, src, "utf8");
console.log("[patch-gallery-newestfile] Added newestFileInDir() and required imports in:", target);
