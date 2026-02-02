#!/usr/bin/env node
/**
 * Patch OTG routes that still reference legacy status "ready".
 * Current ContentStateStatus is: "idle" | "running" | "done" | "error" (plus undefined).
 *
 * This script safely replaces:
 *   state.status !== "ready"  -> state.status !== "done"
 *   state.status === "ready"  -> state.status === "done"
 * and similar for `status` checks, in a small allowlist of files.
 *
 * Run from OTG project root:
 *   node scripts/fix-ready-to-done.cjs
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGETS = [
  "app/api/content/favorite/route.ts",
  // add more if they show up in build errors:
  "app/api/content/clear/route.ts",
];

function patchFile(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.log(`[fix-ready-to-done] skip (missing): ${rel}`);
    return { rel, changed: false, reason: "missing" };
  }
  const before = fs.readFileSync(p, "utf8");

  let after = before;

  // Replace explicit "ready" comparisons.
  after = after.replace(/(\bstatus\b\s*!==\s*)["']ready["']/g, `$1"done"`);
  after = after.replace(/(\bstatus\b\s*===\s*)["']ready["']/g, `$1"done"`);

  // Replace state.status patterns too.
  after = after.replace(/(\bstate\.status\b\s*!==\s*)["']ready["']/g, `$1"done"`);
  after = after.replace(/(\bstate\.status\b\s*===\s*)["']ready["']/g, `$1"done"`);

  if (after === before) {
    console.log(`[fix-ready-to-done] no change: ${rel}`);
    return { rel, changed: false, reason: "no_change" };
  }

  fs.writeFileSync(p, after, "utf8");
  console.log(`[fix-ready-to-done] patched: ${rel}`);
  return { rel, changed: true, reason: "patched" };
}

let changedAny = false;
for (const rel of TARGETS) {
  const r = patchFile(rel);
  if (r.changed) changedAny = true;
}

if (!changedAny) {
  console.log("[fix-ready-to-done] Done. No files changed.");
} else {
  console.log("[fix-ready-to-done] Done. Re-run: npm run build");
}
