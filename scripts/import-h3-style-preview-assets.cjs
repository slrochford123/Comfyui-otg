const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

require("./register-ts-worker.cjs");

const repoRoot = path.resolve(__dirname, "..");
const sourceRoot = process.argv[2] || "/home/shawn-rochford/Desktop/H3_Style_Preview_Clips";
const publicRoot = path.join(repoRoot, "public", "h3", "styles");
const manifestTarget = path.join(repoRoot, "lib", "h3StyleMediaManifest.json");
const mapTarget = path.join(repoRoot, "docs", "h3-style-preview-asset-map.json");
const promptTarget = path.join(repoRoot, "docs", "h3-style-preview-prompts.json");

const { H3_STYLE_PRESETS } = require("../lib/h3StylePresets.ts");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  }
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

async function main() {
  const sourceManifestPath = path.join(sourceRoot, "manifest.json");
  const sourceManifest = JSON.parse(await fsp.readFile(sourceManifestPath, "utf8"));
  const sourceBySlug = new Map(Object.entries(sourceManifest));
  const creativePresets = H3_STYLE_PRESETS.filter((preset) => preset.id !== "none");
  const mediaManifest = {};
  const assetMap = [];
  const promptCatalog = [];
  const missing = [];

  await fsp.mkdir(publicRoot, { recursive: true });
  await fsp.mkdir(path.dirname(mapTarget), { recursive: true });

  for (const preset of creativePresets) {
    const slugs = [preset.id, ...(preset.aliases || [])];
    const sourceSlug = slugs.find((slug) => sourceBySlug.has(slug));
    if (!sourceSlug) {
      missing.push({ id: preset.id, label: preset.label, tried: slugs });
      continue;
    }
    const source = sourceBySlug.get(sourceSlug);
    const sourceMp4 = path.join(sourceRoot, sourceSlug, "source.mp4");
    const promptPath = path.join(sourceRoot, sourceSlug, "prompt.txt");
    if (!exists(sourceMp4) || !exists(promptPath)) {
      missing.push({ id: preset.id, label: preset.label, sourceSlug, missingFile: !exists(sourceMp4) ? "source.mp4" : "prompt.txt" });
      continue;
    }

    const outDir = path.join(publicRoot, preset.id);
    await fsp.mkdir(outDir, { recursive: true });
    const outMp4 = path.join(outDir, "preview.mp4");
    const outPoster = path.join(outDir, "poster.webp");
    const prompt = (await fsp.readFile(promptPath, "utf8")).trim();

    run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", sourceMp4,
      "-map", "0:v:0",
      "-an",
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outMp4,
    ]);
    run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", sourceMp4,
      "-frames:v", "1",
      "-vf", "scale='min(640,iw)':-2:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2'",
      "-c:v", "libwebp",
      "-quality", "82",
      outPoster,
    ]);

    mediaManifest[preset.id] = {
      poster: `/h3/styles/${preset.id}/poster.webp`,
      previewVideo: `/h3/styles/${preset.id}/preview.mp4`,
      previewGenerationPrompt: prompt,
      sourceSlug,
      sourceOrigin: preset.sourceOrigin || "style-art",
    };
    assetMap.push({
      desktopFolder: sourceSlug,
      displayName: source.styleName || preset.label,
      canonicalStyleId: preset.id,
      canonicalStyleName: preset.label,
      sourceOrigin: preset.sourceOrigin || "style-art",
      posterPath: mediaManifest[preset.id].poster,
      mp4Path: mediaManifest[preset.id].previewVideo,
      webmPath: null,
    });
    promptCatalog.push({
      styleId: preset.id,
      styleName: preset.label,
      sourceOrigin: preset.sourceOrigin || "style-art",
      previewGenerationPrompt: prompt,
      sourceSlug,
    });
  }

  await fsp.writeFile(manifestTarget, JSON.stringify(mediaManifest, null, 2) + "\n");
  await fsp.writeFile(mapTarget, JSON.stringify(assetMap, null, 2) + "\n");
  await fsp.writeFile(promptTarget, JSON.stringify(promptCatalog, null, 2) + "\n");

  const defaultPreview = mediaManifest.none;
  if (defaultPreview) throw new Error("Default / None must not receive preview media.");
  if (missing.length) {
    console.error(JSON.stringify({ missing }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    styles: creativePresets.length,
    posters: Object.keys(mediaManifest).length,
    videos: Object.keys(mediaManifest).length,
    manifestTarget,
    mapTarget,
    promptTarget,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
