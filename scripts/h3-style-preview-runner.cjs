#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

require("./register-ts-worker.cjs");

const repoRoot = path.resolve(__dirname, "..");
const scenePath = path.join(repoRoot, "docs", "h3-style-preview-standard-scene.json");
const promptsPath = path.join(repoRoot, "docs", "h3-style-preview-prompts.json");
const assetMapPath = path.join(repoRoot, "docs", "h3-style-preview-asset-map.json");
const jobsPath = path.join(repoRoot, "docs", "h3-style-preview-jobs.json");
const manifestPath = path.join(repoRoot, "lib", "h3StyleMediaManifest.json");
const publicRoot = path.join(repoRoot, "public");

const {
  H3_STYLE_REGISTRY,
  composeH3CanonicalStylePrompt,
} = require("../lib/h3StyleRegistry.ts");
const { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } = require("../lib/paths.ts");

const ownerKey = "h3-style-preview-assets";
const fixedSeed = 47081592360421;
const generationSettings = Object.freeze({
  mode: "h3-text-to-video",
  quality: "lq",
  orientation: "landscape",
  durationSeconds: 5,
  fps: 24,
  seed: fixedSeed,
  workflow: "qualified MiniMax H3 T2V LQ 5s Turbo8 SLA route selected by TEST backend compatibility",
  nativeResolution: "1056x608",
  previewClipSeconds: 1,
  previewClipStartSeconds: 2,
  webm: true,
});

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}.`);
  }
}

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function targets() {
  const only = option("--only").trim();
  const limit = Number(option("--limit", "0"));
  const styles = H3_STYLE_REGISTRY.filter((style) => style.id !== "none");
  const selected = only
    ? styles.filter((style) => style.id === only || style.name.toLowerCase() === only.toLowerCase())
    : styles;
  return Number.isFinite(limit) && limit > 0 ? selected.slice(0, limit) : selected;
}

function stylePrompt(style) {
  const scene = readJson(scenePath, {});
  const baseScene = String(scene.scene || "").trim();
  return composeH3CanonicalStylePrompt(baseScene, style.id);
}

function promptRecord(style) {
  return {
    styleId: style.id,
    styleName: style.name,
    origin: style.origin,
    category: style.category,
    promptBuilderVisualStyle: style.promptBuilderVisualStyle,
    shortDescription: style.shortDescription,
    previewGenerationPrompt: stylePrompt(style),
    styleSpecificNotes: "",
  };
}

function promptPackage() {
  const scene = readJson(scenePath, {});
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    targetCount: H3_STYLE_REGISTRY.filter((style) => style.id !== "none").length,
    excludedStyleIds: ["none"],
    standardizedScene: scene,
    lockedGenerationSettings: generationSettings,
    styles: H3_STYLE_REGISTRY.filter((style) => style.id !== "none").map(promptRecord),
  };
}

function sourceRoot() {
  return safeJoin(OTG_DATA_ROOT, "h3-style-previews", "source");
}

function sourceClipPath(styleId) {
  return safeJoin(sourceRoot(), safeSegment(styleId), "source-5s.mp4");
}

function publicPaths(styleId) {
  return {
    directory: path.join(publicRoot, "h3", "styles", styleId),
    poster: path.join(publicRoot, "h3", "styles", styleId, "poster.webp"),
    mp4: path.join(publicRoot, "h3", "styles", styleId, "preview.mp4"),
    webm: path.join(publicRoot, "h3", "styles", styleId, "preview.webm"),
  };
}

function mediaUrls(styleId) {
  return {
    poster: `/h3/styles/${styleId}/poster.webp`,
    previewVideo: `/h3/styles/${styleId}/preview.mp4`,
    previewWebm: `/h3/styles/${styleId}/preview.webm`,
  };
}

function encodeAssets(styleId, input) {
  const output = publicPaths(styleId);
  fs.mkdirSync(output.directory, { recursive: true });
  const start = generationSettings.previewClipStartSeconds;
  const commonFilter = "scale='min(640,iw)':-2:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2',fps=12";
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start), "-i", input, "-t", "1", "-an", "-vf", `${commonFilter},format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "25", "-movflags", "+faststart", output.mp4]);
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start + 0.4), "-i", input, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2'", "-c:v", "libwebp", "-quality", "78", output.poster]);
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start), "-i", input, "-t", "1", "-an", "-vf", commonFilter, "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1", output.webm]);
}

function publish(style, sourcePath) {
  encodeAssets(style.id, sourcePath);
  const manifest = readJson(manifestPath, {});
  manifest[style.id] = mediaUrls(style.id);
  writeJson(manifestPath, manifest);
  return manifest[style.id];
}

function validatePublished(styles = targets()) {
  const manifest = readJson(manifestPath, {});
  const errors = [];
  for (const style of styles) {
    const media = manifest[style.id];
    if (!media) {
      errors.push(`${style.id}: missing media manifest entry`);
      continue;
    }
    for (const key of ["poster", "previewVideo", "previewWebm"]) {
      const url = media[key];
      if (typeof url !== "string" || !url.startsWith("/h3/styles/")) {
        errors.push(`${style.id}.${key}: invalid URL`);
        continue;
      }
      const file = path.join(publicRoot, url.slice(1));
      if (!fs.existsSync(file) || fs.statSync(file).size <= 0) {
        errors.push(`${style.id}.${key}: missing or empty file ${file}`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return true;
}

function writeMaps(jobs) {
  const manifest = readJson(manifestPath, {});
  const map = H3_STYLE_REGISTRY
    .filter((style) => style.id !== "none")
    .map((style) => ({
      styleId: style.id,
      styleName: style.name,
      origin: style.origin,
      category: style.category,
      sourceClipPath: sourceClipPath(style.id),
      posterPath: manifest[style.id]?.poster || null,
      mp4Path: manifest[style.id]?.previewVideo || null,
      webmPath: manifest[style.id]?.previewWebm || null,
      jobId: jobs[style.id]?.jobId || null,
      status: jobs[style.id]?.status || (manifest[style.id] ? "published" : "missing"),
      notes: jobs[style.id]?.notes || "",
    }));
  writeJson(assetMapPath, { version: 1, updatedAt: new Date().toISOString(), assets: map });
}

async function waitForJob(job) {
  const { getH3DirectJob } = require("../lib/h3DirectJobs.ts");
  for (;;) {
    const current = await getH3DirectJob(ownerKey, job.id);
    if (!current) throw new Error(`Job disappeared: ${job.id}`);
    if (current.status === "completed") return current;
    if (current.status === "failed" || current.status === "canceled") {
      throw new Error(`${job.id} ${current.status}: ${current.error || current.statusMessage}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function generate() {
  const {
    createH3DirectJob,
    startH3DirectJob,
  } = require("../lib/h3DirectJobs.ts");
  writeJson(promptsPath, promptPackage());
  const jobs = readJson(jobsPath, {});
  const selected = targets();
  ensureDir(sourceRoot());
  for (const style of selected) {
    if (hasFlag("--resume") && jobs[style.id]?.status === "published" && fs.existsSync(sourceClipPath(style.id))) {
      continue;
    }
    const prompt = stylePrompt(style);
    const job = await createH3DirectJob(ownerKey, {
      mode: generationSettings.mode,
      quality: generationSettings.quality,
      orientation: generationSettings.orientation,
      durationSeconds: generationSettings.durationSeconds,
      prompt,
      stylePresetId: style.id,
      seed: generationSettings.seed,
      optionalLoras: [],
      firstImage: null,
      lastImage: null,
      images: [],
      videos: [],
      audios: [],
    }, null);
    jobs[style.id] = {
      styleId: style.id,
      styleName: style.name,
      origin: style.origin,
      jobId: job.id,
      status: "submitted",
      prompt,
      sourceClipPath: sourceClipPath(style.id),
      updatedAt: new Date().toISOString(),
    };
    writeJson(jobsPath, jobs);
    startH3DirectJob(job);
    const completed = await waitForJob(job);
    if (!completed.outputPath || !fs.existsSync(completed.outputPath)) {
      throw new Error(`${style.id}: completed job did not produce an output path.`);
    }
    ensureDir(path.dirname(sourceClipPath(style.id)));
    await fsp.copyFile(completed.outputPath, sourceClipPath(style.id));
    const media = publish(style, sourceClipPath(style.id));
    jobs[style.id] = {
      ...jobs[style.id],
      status: "published",
      backend: completed.backend,
      promptId: completed.promptId,
      workflowId: completed.workflowId,
      workflowFile: completed.workflowFile,
      completedOutputPath: completed.outputPath,
      media,
      updatedAt: new Date().toISOString(),
    };
    writeJson(jobsPath, jobs);
    writeMaps(jobs);
    console.log(`Published ${style.id}: ${style.name}`);
  }
  validatePublished(selected);
  writeMaps(jobs);
}

async function encodeExisting() {
  const jobs = readJson(jobsPath, {});
  for (const style of targets()) {
    const source = sourceClipPath(style.id);
    if (!fs.existsSync(source)) throw new Error(`${style.id}: missing source clip ${source}`);
    const media = publish(style, source);
    jobs[style.id] = {
      ...(jobs[style.id] || {}),
      styleId: style.id,
      styleName: style.name,
      origin: style.origin,
      status: "published",
      sourceClipPath: source,
      media,
      updatedAt: new Date().toISOString(),
    };
  }
  writeJson(jobsPath, jobs);
  writeMaps(jobs);
  validatePublished(targets());
}

async function main() {
  const command = process.argv[2];
  if (command === "prompts") {
    writeJson(promptsPath, promptPackage());
    writeMaps(readJson(jobsPath, {}));
    console.log(`Wrote ${promptsPath}`);
    return;
  }
  if (command === "generate") {
    await generate();
    return;
  }
  if (command === "encode-existing") {
    await encodeExisting();
    return;
  }
  if (command === "validate") {
    validatePublished(targets());
    console.log(`Validated ${targets().length} H3 style preview asset sets.`);
    return;
  }
  console.error("Usage: h3-style-preview-runner.cjs prompts | generate [--resume] [--limit N] [--only ID] | encode-existing [--limit N] [--only ID] | validate [--limit N] [--only ID]");
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
