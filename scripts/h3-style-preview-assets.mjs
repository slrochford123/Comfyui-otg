#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "lib", "h3StyleMediaManifest.json");
const publicRoot = path.join(root, "public");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) fail(`${command} failed with exit code ${result.status}.`);
}

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function validate() {
  const manifest = readManifest();
  const errors = [];
  for (const [styleId, media] of Object.entries(manifest)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(styleId)) errors.push(`Invalid style ID: ${styleId}`);
    for (const [kind, url] of Object.entries(media)) {
      if (typeof url !== "string" || !url.startsWith("/h3/styles/")) {
        errors.push(`${styleId}.${kind} must be a /h3/styles/ URL.`);
        continue;
      }
      const file = path.join(publicRoot, url.slice(1));
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) errors.push(`Missing or empty: ${file}`);
    }
  }
  if (errors.length) fail(errors.join("\n"));
  console.log(`Validated ${Object.keys(manifest).length} published H3 style-media entries.`);
}

function encode() {
  const styleId = option("--style");
  const input = path.resolve(option("--input"));
  const start = Number(option("--start", "0"));
  const includeWebm = process.argv.includes("--webm");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(styleId)) fail("--style must be a stable lowercase style ID.");
  if (!input || !fs.existsSync(input)) fail("--input must point to an existing reviewed H3 video.");
  if (!Number.isFinite(start) || start < 0) fail("--start must be a non-negative number of seconds.");

  const outputDirectory = path.join(publicRoot, "h3", "styles", styleId);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const mp4 = path.join(outputDirectory, "preview.mp4");
  const poster = path.join(outputDirectory, "poster.webp");
  const commonFilter = "scale='min(640,iw)':-2:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2',fps=12";
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start), "-i", input, "-t", "1", "-an", "-vf", `${commonFilter},format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "25", "-movflags", "+faststart", mp4]);
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start + 0.4), "-i", input, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2'", "-c:v", "libwebp", "-quality", "78", poster]);

  const media = {
    poster: `/h3/styles/${styleId}/poster.webp`,
    previewVideo: `/h3/styles/${styleId}/preview.mp4`,
  };
  if (includeWebm) {
    const webm = path.join(outputDirectory, "preview.webm");
    run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start), "-i", input, "-t", "1", "-an", "-vf", commonFilter, "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1", webm]);
    media.previewWebm = `/h3/styles/${styleId}/preview.webm`;
  }
  const manifest = readManifest();
  manifest[styleId] = media;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  validate();
  console.log(`Published reviewed preview assets for ${styleId}.`);
}

const command = process.argv[2];
if (command === "validate") validate();
else if (command === "encode") encode();
else fail("Usage: h3-style-preview-assets.mjs validate | encode --style ID --input VIDEO --start SECONDS [--webm]");
