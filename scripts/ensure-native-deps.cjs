#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const REQUIRED_NODE_MAJOR = 22;

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function fail(message) {
  console.error("[native-deps] " + message);
  process.exit(1);
}

function warn(message) {
  console.warn("[native-deps] " + message);
}

function log(message) {
  console.log("[native-deps] " + message);
}

function checkNodeMajor() {
  const major = Number(process.versions.node.split(".")[0]);

  if (major !== REQUIRED_NODE_MAJOR) {
    fail(
      "Wrong Node major version. Expected Node " +
        REQUIRED_NODE_MAJOR +
        ".x, got " +
        process.version +
        ". Use Node 22, then run npm install."
    );
  }

  log("Node " + process.version + " OK. ABI " + process.versions.modules + ".");
}

function tryLoadBetterSqlite() {
  // Never dlopen two ABI variants in this process after rebuilding a native
  // module. Probe in a fresh child both before and after the rebuild.
  const probe = spawnSync(process.execPath, ["-e", "const D=require('better-sqlite3');const db=new D(':memory:');db.close();"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 15000,
  });
  return probe.status === 0 ? null : new Error(probe.stderr || probe.error?.message || "Native SQLite probe failed.");
}

function errorText(err) {
  if (!err) return "";
  return String(err && err.stack ? err.stack : err.message || err);
}

function rebuildBetterSqlite() {
  log("Running npm rebuild better-sqlite3...");
  const result = spawnSync(npmCommand(), ["rebuild", "better-sqlite3"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  return result.status === 0;
}

checkNodeMajor();

const firstError = tryLoadBetterSqlite();

if (!firstError) {
  log("better-sqlite3 OK for current Node ABI.");
  process.exit(0);
}

warn("better-sqlite3 failed to load. Rebuilding for current Node ABI.");
warn(errorText(firstError));

if (!rebuildBetterSqlite()) {
  fail("npm rebuild better-sqlite3 failed. Run npm install under Node 22.");
}

const secondError = tryLoadBetterSqlite();

if (secondError) {
  warn(errorText(secondError));
  fail("better-sqlite3 still cannot load after rebuild. Delete node_modules and run npm install under Node 22.");
}

log("better-sqlite3 rebuilt and verified.");
