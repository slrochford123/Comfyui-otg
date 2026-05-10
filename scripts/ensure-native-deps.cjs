#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const REQUIRED_NODE_MAJOR = 20;

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
        ". Use Node 20, then run npm install."
    );
  }

  log("Node " + process.version + " OK. ABI " + process.versions.modules + ".");
}

function tryLoadBetterSqlite() {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.close();
    return null;
  } catch (err) {
    return err;
  }
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
  fail("npm rebuild better-sqlite3 failed. Run npm install under Node 20.");
}

const secondError = tryLoadBetterSqlite();

if (secondError) {
  warn(errorText(secondError));
  fail("better-sqlite3 still cannot load after rebuild. Delete node_modules and run npm install under Node 20.");
}

log("better-sqlite3 rebuilt and verified.");