#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MEDIA_EXTS = new Set([".mp4", ".webm", ".mov", ".mkv", ".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function statePathFor(job) {
  const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dataRoot, "content_state", `${job.ownerKey}.json`);
}

function readState(job) {
  return readJson(statePathFor(job), {
    status: "idle",
    fileName: null,
    kind: null,
    deviceId: null,
    workflowId: null,
    workflowTitle: null,
    promptId: null,
    positivePrompt: null,
    negativePrompt: null,
    submitPayload: null,
    favorited: false,
    lastSyncedPromptId: null,
    startedAt: null,
    readyAt: null,
    updatedAt: null,
    error: null,
  });
}

function writeState(job, patch) {
  const current = readState(job);
  writeJson(statePathFor(job), {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  });
}

function markError(job, message) {
  writeState(job, {
    status: "error",
    error: String(message || "Unknown Wan2GP error"),
  });
}

function markReady(job, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const kind = [".mp4", ".webm", ".mov", ".mkv"].includes(ext) ? "video" : "image";
  writeState(job, {
    status: "done",
    fileName,
    kind,
    readyAt: Date.now(),
    error: null,
  });
}

function listMediaFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => MEDIA_EXTS.has(path.extname(name).toLowerCase()))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, full, mtimeMs: stat.mtimeMs || 0, birthtimeMs: stat.birthtimeMs || 0 };
    });
}

function snapshot(dir) {
  return new Set(listMediaFiles(dir).map((item) => item.name.toLowerCase()));
}

function pickOutput(dir, beforeSet, startedAt) {
  const files = listMediaFiles(dir);
  const fresh = files
    .filter((item) => !beforeSet.has(item.name.toLowerCase()))
    .sort((a, b) => (b.mtimeMs || b.birthtimeMs) - (a.mtimeMs || a.birthtimeMs));
  if (fresh[0]) return fresh[0];

  const recent = files
    .filter((item) => Math.max(item.mtimeMs || 0, item.birthtimeMs || 0) >= startedAt - 1000)
    .sort((a, b) => (b.mtimeMs || b.birthtimeMs) - (a.mtimeMs || a.birthtimeMs));
  if (recent[0]) return recent[0];

  return files.sort((a, b) => (b.mtimeMs || b.birthtimeMs) - (a.mtimeMs || a.birthtimeMs))[0] || null;
}

function writeMeta(job, filePath) {
  const stat = fs.statSync(filePath);
  const metaPath = `${filePath}.meta.json`;
  const existing = readJson(metaPath, {}) || {};
  const baseName = path.basename(filePath);
  writeJson(metaPath, {
    ...existing,
    originalName: existing.originalName || baseName,
    renamedName: existing.renamedName || baseName,
    favorite: Boolean(existing.favorite),
    positivePrompt: job.positivePrompt || null,
    negativePrompt: job.negativePrompt || null,
    submitPayload: job.submitPayload || null,
    workflowId: job.workflowId || "wan2gp-i2v",
    workflowTitle: job.workflowTitle || "Wan 2.2 Image to Video",
    sourcePromptId: null,
    createdAt: existing.createdAt || stat.birthtimeMs || stat.mtimeMs || Date.now(),
    updatedAt: Date.now(),
  });
}

function buildQueueManifest(job, attachmentName) {
  return [
    {
      id: 1,
      params: {
        model_type: job.modelType || "i2v_2_2",
        prompt: String(job.positivePrompt || ""),
        negative_prompt: String(job.negativePrompt || ""),
        resolution: String(job.resolution || "1280x720"),
        video_length: Math.max(1, Math.floor(Number(job.videoLength) || 121)),
        seed: Number.isFinite(Number(job.seed)) ? Math.floor(Number(job.seed)) : -1,
        image_mode: 0,
        image_start: attachmentName,
      },
    },
  ];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    ...options,
  });
  return result;
}

function zipQueue(job, sourceDir, zipPath) {
  const pythonExe = String(job.wanPython || "python").trim() || "python";
  const script = [
    "import os, sys, zipfile",
    "src = sys.argv[1]",
    "dst = sys.argv[2]",
    "with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zf:",
    "    for name in os.listdir(src):",
    "        full = os.path.join(src, name)",
    "        if os.path.isfile(full):",
    "            zf.write(full, arcname=name)",
  ].join("\n");
  const result = run(pythonExe, ["-c", script, sourceDir, zipPath], { cwd: job.wanRoot });
  if (result.status !== 0) {
    throw new Error(`Failed to create Wan2GP queue zip: ${result.stderr || result.stdout || result.error || "unknown error"}`);
  }
}

function main() {
  const jobFile = process.argv[2];
  if (!jobFile) {
    throw new Error("Missing job file path");
  }

  const job = readJson(jobFile, null);
  if (!job) {
    throw new Error(`Could not read job file: ${jobFile}`);
  }

  const startedAt = Date.now();
  const logFile = path.join(job.jobDir, "runner.log");
  ensureDir(job.jobDir);
  ensureDir(job.outputDir);

  const appendLog = (message) => {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`, "utf-8");
  };

  try {
    appendLog(`Starting Wan2GP job ${job.jobId}`);
    const wgpPy = path.join(job.wanRoot, "wgp.py");
    if (!fs.existsSync(wgpPy)) {
      throw new Error(`wgp.py not found under ${job.wanRoot}`);
    }

    const pythonExe = String(job.wanPython || "python").trim() || "python";
    const attachmentExt = path.extname(job.inputImagePath || "").toLowerCase() || ".png";
    const attachmentName = `task1_image_start_0${attachmentExt}`;
    const queueDir = path.join(job.jobDir, "queue");
    ensureDir(queueDir);

    const queueImagePath = path.join(queueDir, attachmentName);
    fs.copyFileSync(job.inputImagePath, queueImagePath);
    writeJson(path.join(queueDir, "queue.json"), buildQueueManifest(job, attachmentName));

    const queueZipPath = path.join(job.jobDir, "queue.zip");
    zipQueue(job, queueDir, queueZipPath);

    const beforeSet = snapshot(job.outputDir);
    const env = { ...process.env };
    if (job.gpuVisibility) {
      env.CUDA_VISIBLE_DEVICES = String(job.gpuVisibility);
      appendLog(`CUDA_VISIBLE_DEVICES=${env.CUDA_VISIBLE_DEVICES}`);
    }

    const args = ["wgp.py", "--process", queueZipPath, "--output-dir", job.outputDir, "--gpu", "cuda:0"];
    appendLog(`Running: ${pythonExe} ${args.join(" ")}`);

    const result = run(pythonExe, args, {
      cwd: job.wanRoot,
      env,
      maxBuffer: 1024 * 1024 * 20,
    });

    if (result.stdout) fs.writeFileSync(path.join(job.jobDir, "stdout.log"), result.stdout, "utf-8");
    if (result.stderr) fs.writeFileSync(path.join(job.jobDir, "stderr.log"), result.stderr, "utf-8");

    if (result.status !== 0) {
      throw new Error(`Wan2GP exited with code ${result.status}. ${String(result.stderr || result.stdout || result.error || "").trim()}`);
    }

    const output = pickOutput(job.outputDir, beforeSet, startedAt);
    if (!output) {
      throw new Error(`Wan2GP completed but no output file was found in ${job.outputDir}`);
    }

    writeMeta(job, output.full);
    markReady(job, output.name);
    appendLog(`Completed with output ${output.name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown Wan2GP error");
    appendLog(`ERROR: ${message}`);
    markError(job, message);
    process.exitCode = 1;
  }
}

main();
