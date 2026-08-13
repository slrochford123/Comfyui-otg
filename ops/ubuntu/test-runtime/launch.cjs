"use strict";

const path = require("node:path");

const workRepo = process.env.OTG_WORK_REPO;
const deployRoot = process.env.OTG_DEPLOY_ROOT;

if (!workRepo || !deployRoot) {
  throw new Error("OTG_WORK_REPO and OTG_DEPLOY_ROOT are required.");
}

const nextEnvPath = require.resolve("@next/env", {
  paths: [deployRoot],
});
const { loadEnvConfig } = require(nextEnvPath);

process.env.NODE_ENV = "production";
loadEnvConfig(workRepo, false);

process.env.NODE_ENV = "production";
process.env.HOSTNAME = "100.75.162.64";
process.env.PORT = "3001";
process.env.NEXT_TELEMETRY_DISABLED = "1";

process.chdir(deployRoot);
require(path.join(deployRoot, "server.js"));
