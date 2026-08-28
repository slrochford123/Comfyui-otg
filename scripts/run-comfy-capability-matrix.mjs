import fs from "node:fs";
import path from "node:path";
import { applyWanRifeFrameTiming } from "../lib/wanRifeFrameTiming.ts";

const endpoint = String(process.argv[2] || "").replace(/\/+$/, "");
const backendId = String(process.argv[3] || "");
const workflowFiles = process.argv.slice(4);
if (!endpoint || !backendId || !workflowFiles.length) {
  throw new Error("Usage: node scripts/run-comfy-capability-matrix.mjs <endpoint> <backend-id> <workflow-file> [...]");
}

const controlBaseUrl = String(process.env.OTG_BASE_URL || "").replace(/\/+$/, "");
const workerToken = String(process.env.OTG_WORKER_TOKEN || "");
if (!controlBaseUrl || !workerToken) {
  throw new Error("OTG_BASE_URL and OTG_WORKER_TOKEN are required so capability runs participate in cluster GPU arbitration.");
}

function physicalLockId() {
  const url = new URL(endpoint);
  if (["100.98.212.116", "192.168.1.113", "slr", "otg-slr"].includes(url.hostname)) return "gpu:slr-5060";
  if (["100.75.162.64", "192.168.1.166", "shawn", "otg-shawn"].includes(url.hostname)) return "gpu:shawn-3090";
  throw new Error(`Capability endpoint is not mapped to a cluster GPU: ${endpoint}`);
}

async function controlRequest(route, payload) {
  const response = await fetch(`${controlBaseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${workerToken}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`WorkerManager ${route} failed (${response.status}): ${JSON.stringify(json)}`);
  return json;
}

async function acquireGpuLease(runName) {
  const lockId = physicalLockId();
  const ownerId = `capability-matrix-${backendId}-${runName}`;
  const response = await controlRequest("/api/worker-control/resource-lock/acquire", {
    lockId,
    ownerId,
    workerId: "comfy-capability-matrix",
    resourceName: lockId === "gpu:slr-5060" ? "image" : "video",
    ttlSeconds: 21_600,
  });
  return { ...response.lock, lockId, ownerId };
}

async function releaseGpuLease(lease) {
  await controlRequest("/api/worker-control/resource-lock/release", {
    lockId: lease.lockId,
    ownerId: lease.ownerId,
    fencingToken: lease.fencingToken,
  });
}

const resultFile = `/tmp/dual-gpu-workflow-results-${backendId}.json`;
const results = process.env.OTG_APPEND_RESULTS === "1" && fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, "utf8")) : [];
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function graphFromFile(filename) {
  const document = JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
  const graph = document.prompt || document.output || document;
  return Object.fromEntries(Object.entries(graph).filter(([, node]) => node && typeof node === "object" && typeof node.class_type === "string"));
}

function prepareGraph(graph, runName, seed) {
  const inputImage = process.env.OTG_TEST_INPUT_IMAGE || "example.png";
  for (const node of Object.values(graph)) {
    const inputs = node.inputs || {};
    if (node.class_type === "LoadImage" && typeof inputs.image === "string") inputs.image = inputImage;
    if (/CLIPTextEncode/i.test(node.class_type) && typeof inputs.text === "string") {
      inputs.text = inputs.text.toLowerCase().includes("negative") ? "blurry, low quality" : "a cinematic lighthouse on a rocky coast at sunrise, highly detailed";
    }
    for (const field of ["seed", "noise_seed"]) if (typeof inputs[field] === "number") inputs[field] = seed;
    for (const field of ["width", "height"]) if (typeof inputs[field] === "number") inputs[field] = 512;
    if (typeof inputs.filename_prefix === "string") inputs.filename_prefix = `OTG-dual-gpu/${runName}`;
  }
  return graph;
}

function filesFromHistory(history) {
  const files = [];
  for (const output of Object.values(history?.outputs || {})) {
    for (const value of Object.values(output || {})) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (item && typeof item.filename === "string") files.push(item);
      }
    }
  }
  return files;
}

async function stats() {
  const response = await fetch(`${endpoint}/system_stats`, { signal: AbortSignal.timeout(10_000) });
  const json = await response.json();
  const device = json.devices?.[0] || {};
  return { total: Number(device.vram_total || 0), free: Number(device.vram_free || 0) };
}

async function runWorkflow(filename, temperature) {
  const id = path.relative("comfy_workflows", filename).replaceAll(path.sep, "/").replace(/\.json$/i, "");
  const runName = `${id.replace(/[^a-z0-9]+/gi, "-")}-${temperature}-${Date.now()}`;
  const lease = await acquireGpuLease(runName);
  let safeToRelease = true;
  try {
    if (temperature === "cold") {
      await fetch(`${endpoint}/free`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => null);
      await sleep(1_000);
    }
  const seed = temperature === "cold" ? 424242 : 424243;
  const graph = prepareGraph(graphFromFile(filename), runName, seed);
  const wanTiming = /WAN 2\.2/i.test(filename)
    ? applyWanRifeFrameTiming(graph, { workflowFile: filename, durationSeconds: 5 })
    : null;
  const before = await stats();
  let peakUsed = before.total - before.free;
  const started = Date.now();
  let submission;
  try {
    submission = await fetch(`${endpoint}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: `otg-dual-gpu-${backendId}-${Date.now()}` }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    safeToRelease = false;
    throw error;
  }
  const submitted = await submission.json().catch(() => ({}));
  if (!submission.ok) throw new Error(`Submission failed (${submission.status}): ${JSON.stringify(submitted)}`);
  if (!submitted.prompt_id) {
    safeToRelease = false;
    throw new Error(`Submission succeeded without prompt_id (${submission.status}): ${JSON.stringify(submitted)}`);
  }
  let history = null;
  while (Date.now() - started < 20 * 60_000) {
    const current = await stats().catch(() => before);
    peakUsed = Math.max(peakUsed, current.total - current.free);
    const response = await fetch(`${endpoint}/history/${encodeURIComponent(submitted.prompt_id)}`, { signal: AbortSignal.timeout(10_000) });
    const document = await response.json();
    history = document[submitted.prompt_id];
    if (history?.status?.completed) break;
    if (history?.status?.status_str === "error") break;
    await sleep(1_000);
  }
  const runtimeSeconds = (Date.now() - started) / 1_000;
  const files = filesFromHistory(history);
  const status = history?.status?.status_str || "timeout";
  const downloaded = [];
  if (status === "success") {
    for (const file of files) {
      const params = new URLSearchParams({ filename: file.filename, type: file.type || "output", subfolder: file.subfolder || "" });
      const response = await fetch(`${endpoint}/view?${params}`);
      if (!response.ok) throw new Error(`Output download failed (${response.status}) for ${file.filename}`);
      const target = `/tmp/${backendId}-${path.basename(file.filename)}`;
      fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
      downloaded.push(target);
    }
  }
  const errorMessages = (history?.status?.messages || []).filter((message) => message?.[0] === "execution_error");
  const result = {
    backend: backendId,
    endpoint,
    workflowId: id,
    workflowFile: filename,
    temperature,
    resolution: "512x512",
    frames: null,
    fps: null,
    duration: wanTiming?.durationSeconds || null,
    wanTiming,
    seed,
    runtimeSeconds,
    peakVramBytes: peakUsed,
    promptId: submitted.prompt_id,
    outputPaths: downloaded,
    pass: status === "success" && downloaded.length > 0,
    failureReason: status === "success" && downloaded.length > 0 ? null : JSON.stringify(errorMessages || status),
  };
  results.push(result);
  fs.writeFileSync(resultFile, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(result));
  } finally {
    if (safeToRelease) await releaseGpuLease(lease);
    else console.error(`Retaining ${lease.lockId} lease to expiry because the Comfy submission outcome is ambiguous.`);
  }
}

for (const filename of workflowFiles) {
  for (const temperature of (process.env.OTG_TEMPERATURES || "cold,warm").split(",").filter(Boolean)) {
    try {
      await runWorkflow(filename, temperature);
    } catch (error) {
      const result = { backend: backendId, endpoint, workflowFile: filename, temperature, pass: false, failureReason: String(error?.stack || error) };
      results.push(result);
      fs.writeFileSync(resultFile, `${JSON.stringify(results, null, 2)}\n`);
      console.log(JSON.stringify(result));
      break;
    }
  }
}
