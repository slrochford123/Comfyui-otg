#!/usr/bin/env node
"use strict";

// Build the vendored embedded editor without fetching packages or invoking the
// upstream SEO/MCP builds. npm ci installs its separate, locked dependencies.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const vendor = path.join(root, "vendor", "sequence");
const output = path.join(root, "timeline-editor");
const required = [
  "package.json", "package-lock.json", "tsconfig.json", "vite.otg.config.ts",
  "otg.html", "LICENSE", "THIRD_PARTY_NOTICES.txt", "OTG_CHANGES.md",
  "node_modules/typescript/bin/tsc", "node_modules/vite/bin/vite.js",
];
for (const file of required) {
  if (!fs.existsSync(path.join(vendor, file))) {
    throw new Error(`Missing vendor/sequence/${file}; restore the vendored source and run npm ci.`);
  }
}

function runNode(relativeScript, args) {
  execFileSync(process.execPath, [path.join(vendor, relativeScript), ...args], {
    cwd: vendor, stdio: "inherit",
  });
}
runNode("node_modules/typescript/bin/tsc", ["-b"]);
runNode("node_modules/vite/bin/vite.js", ["build", "--config", "vite.otg.config.ts"]);

// Explicit source roots prevent runtime state or unrelated local directories
// from entering the corresponding-source download. Include the complete host
// implementation, workflow definitions, build scripts and modified editor.
const sourceRoots = [
  "app", "lib", "src", "config", "scripts", "public", "tests",
  "workflows", "comfy_workflows", "h3-qualified-source", "vendor/sequence",
];
const sourceFiles = [
  "package.json", "package-lock.json", "next.config.mjs", "next-env.d.ts",
  "tsconfig.json", "postcss.config.mjs", "eslint.config.mjs", "vitest.config.ts",
  "playwright.config.ts", "instrumentation.ts", "capacitor.config.ts",
  ".nvmrc", ".gitignore", "FINAL_EXPORT_STUDIO_SOURCE.md",
];
const excludedDirectories = new Set([
  ".git", "node_modules", ".cache", ".next", ".vite", ".turbo",
  "dist", "dist-otg", "dist-mcp", "coverage",
  ".otg-state", ".otg-backups", "__pycache__", ".pytest_cache",
  ".ruff_cache", "playwright-report", "test-results", "tmp", ".tmp",
  "qualification", "qualification-evidence", "qa",
]);
const sensitiveOrGenerated = /(?:\.(?:env(?:\..*)?|pem|key|p12|crt|cert|jks|keystore|db(?:-shm|-wal)?|sqlite3?|log|tsbuildinfo|pyc|pyo|safetensors|ckpt|gguf|pth|pt|onnx|apk|aab|zip|tar\.gz)$|(?:^|[-_.])(?:service-account|credentials)(?:[-_.]|$)|\.(?:bak|backup|orig|old|tmp)(?:[-.]|$))/i;
function excluded(relative, name) {
  return excludedDirectories.has(name) || name.startsWith(".env") ||
    name.startsWith(".next") || sensitiveOrGenerated.test(name) ||
    /(?:^|\/)qa(?:[-_.]|\/)/i.test(relative) ||
    /(?:^|\/)(?:apply-.*\.py|.*\.before-.*|.*\.pre-.*)$/.test(relative);
}
const files = [];
function collect(relative) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return;
  const stat = fs.lstatSync(full);
  // Never follow local symlinks, which can point to credentials, media or
  // dependencies outside this source tree.
  if (stat.isSymbolicLink() || excluded(relative, path.basename(relative))) return;
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(full).sort()) collect(`${relative}/${name}`);
  } else if (stat.isFile()) {
    files.push(relative);
  }
}
for (const relative of [...sourceRoots, ...sourceFiles]) collect(relative);
files.sort();
for (const requiredFile of ["app/app/timeline-editor/page.tsx", "lib/timelineEditor/store.ts", "vendor/sequence/src/otg-entry.tsx", "scripts/build-final-export-studio.cjs", ...sourceFiles]) {
  if (!files.includes(requiredFile)) throw new Error(`Required corresponding source missing: ${requiredFile}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "otg-studio-build-"));
const stage = path.join(root, `.timeline-editor-build-${process.pid}`);
if (fs.existsSync(stage)) {
  fs.rmSync(temporary, { recursive: true, force: true });
  throw new Error(`Build staging directory already exists: ${stage}`);
}
try {
  fs.cpSync(path.join(vendor, "dist-otg"), stage, { recursive: true });
  if (!fs.existsSync(path.join(stage, "otg.html"))) throw new Error("Embedded editor build did not produce otg.html.");
  fs.copyFileSync(path.join(vendor, "LICENSE"), path.join(stage, "LICENSE.txt"));
  fs.copyFileSync(path.join(vendor, "THIRD_PARTY_NOTICES.txt"), path.join(stage, "THIRD_PARTY_NOTICES.txt"));
  fs.copyFileSync(path.join(root, "FINAL_EXPORT_STUDIO_SOURCE.md"), path.join(stage, "SOURCE.md"));

  const list = path.join(temporary, "source-files");
  fs.writeFileSync(list, `${files.join("\0")}\0`);
  // GNU tar is already part of the Linux deployment infrastructure. Sorted
  // inputs and normalized metadata make this archive independent of build time.
  execFileSync("tar", [
    "--create", "--gzip", "--file", path.join(stage, "source.tar.gz"),
    "--directory", root, "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
    "--format=gnu", "--transform=s,^,otg/,", "--null", "--verbatim-files-from",
    "--no-recursion", "--files-from", list,
  ], { stdio: "inherit" });

  const pkg = JSON.parse(fs.readFileSync(path.join(vendor, "package.json"), "utf8"));
  fs.writeFileSync(path.join(stage, "EDITOR_PROVENANCE.json"), JSON.stringify({
    editor: "Sequence", version: pkg.version, license: pkg.license,
    upstreamCommit: "8f301707e61d60e69abd6becba9a02c9aa94d489",
    source: "source.tar.gz", sourceFiles: files.length,
    build: "npm ci && npm run build", entry: "otg.html",
  }, null, 2) + "\n");
  fs.rmSync(output, { recursive: true, force: true });
  fs.renameSync(stage, output);
  console.log(`Final Export Studio: bundled editor and ${files.length} corresponding source files.`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.rmSync(stage, { recursive: true, force: true });
}
