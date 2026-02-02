/**
 * fix-ready-to-done-all.cjs
 * Replaces legacy ContentState status checks for "ready" -> "done" across the repo.
 * Safe-ish: only targets comparisons and string literals for status, not arbitrary words.
 *
 * Usage (from repo root):
 *   node scripts/fix-ready-to-done-all.cjs
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGET_DIRS = [
  "app",
  "lib",
];

const FILE_RE = /\.(ts|tsx|js|jsx)$/i;

// patterns: only swap exact "ready" string literals in status comparisons and switch/case labels
const REPLACERS = [
  // state.status !== "ready"  -> "done"
  { re: /(\bstatus\s*!==\s*")ready(")/g, rep: '$1done$2' },
  { re: /(\bstatus\s*===\s*")ready(")/g, rep: '$1done$2' },

  // state.status == "ready"/!= etc (rare)
  { re: /(\bstatus\s*!=\s*")ready(")/g, rep: '$1done$2' },
  { re: /(\bstatus\s*==\s*")ready(")/g, rep: '$1done$2' },

  // switch (status) { case "ready": ... }
  { re: /(\bcase\s*")ready(")/g, rep: '$1done$2' },

  // if ("ready" === status)
  { re: /(")ready("\s*===\s*\bstatus\b)/g, rep: '$1done$2' },
  { re: /(")ready("\s*!==\s*\bstatus\b)/g, rep: '$1done$2' },

  // object literals: status: "ready"
  { re: /(\bstatus\s*:\s*")ready(")/g, rep: '$1done$2' },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // skip node_modules/.next/etc
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
      walk(p, out);
    } else if (e.isFile() && FILE_RE.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function patchFile(fp) {
  const before = fs.readFileSync(fp, "utf8");
  let after = before;
  for (const r of REPLACERS) after = after.replace(r.re, r.rep);
  if (after !== before) {
    fs.writeFileSync(fp, after, "utf8");
    return true;
  }
  return false;
}

let changed = [];
for (const d of TARGET_DIRS) {
  const abs = path.join(ROOT, d);
  for (const fp of walk(abs)) {
    if (patchFile(fp)) changed.push(path.relative(ROOT, fp));
  }
}

if (!changed.length) {
  console.log("[fix-ready-to-done-all] No changes needed.");
  process.exit(0);
}

console.log(`[fix-ready-to-done-all] Updated ${changed.length} file(s):`);
for (const c of changed) console.log(" -", c);
