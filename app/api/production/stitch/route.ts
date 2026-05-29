import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SceneInput = {
  card?: number;
  clipIndex?: number;
  index?: number;
  videoPath?: string;
  serverPath?: string;
  generatedVideoPath?: string;
  localPath?: string;
  filePath?: string;
  outputPath?: string;
  path?: string;
  url?: string;
  src?: string;
  videoUrl?: string;
  serverUrl?: string;
  generatedVideoUrl?: string;
  fileName?: string;
  filename?: string;
  name?: string;
  sourceName?: string;
  originalFileName?: string;
  editedFileName?: string;
  clip?: Record<string, unknown>;
};

type ResolvedVideo = {
  card: number;
  videoPath: string;
  source: "path" | "url" | "filename";
  cleanup?: boolean;
  debug?: Record<string, unknown>;
};
type TransitionInput = {
  type?: string;
  durationSeconds?: number;
};
type NormalizedTransition = {
  type: "cut" | "crossfade" | "fade_black" | "fade_white" | "slide_left" | "slide_right";
  durationSeconds: number;
};
type ExportPreset = "draft" | "standard" | "high_quality" | "mobile" | "youtube" | "play_store_preview";

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(?:$|[?#])/i;

function fileUrlFor(absPath: string) {
  return `/api/file?path=${encodeURIComponent(absPath)}`;
}

function ffmpegBin() {
  return String(process.env.FFMPEG_PATH || process.env.OTG_FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg";
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

function runFfprobe(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const bin = String(process.env.FFPROBE_PATH || process.env.OTG_FFPROBE_PATH || "ffprobe").trim() || "ffprobe";
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `ffprobe exited with code ${code}`));
    });
  });
}

async function probeDuration(filePath: string) {
  const raw = await runFfprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function probeHasAudio(filePath: string) {
  const raw = await runFfprobe([
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=index",
    "-of",
    "csv=p=0",
    filePath,
  ]);
  return raw.trim().length > 0;
}

function normalizeTransition(input: TransitionInput | undefined): NormalizedTransition {
  const rawType = String(input?.type || "cut").trim();
  const type = (["crossfade", "fade_black", "fade_white", "slide_left", "slide_right"].includes(rawType)
    ? rawType
    : "cut") as NormalizedTransition["type"];
  return {
    type,
    durationSeconds: Math.max(0.1, Math.min(2, Number(input?.durationSeconds || 0.5) || 0.5)),
  };
}

function transitionsFromBody(body: any): NormalizedTransition[] {
  const raw =
    body?.transitions ??
    body?.assembleTransitions ??
    body?.payload?.transitions ??
    body?.data?.transitions ??
    [];
  if (!Array.isArray(raw)) return [];
  return raw.map((transition) => normalizeTransition(transition));
}

function xfadeName(type: NormalizedTransition["type"]) {
  if (type === "fade_black") return "fadeblack";
  if (type === "fade_white") return "fadewhite";
  if (type === "slide_left") return "slideleft";
  if (type === "slide_right") return "slideright";
  return "fade";
}

function normalizeExportPreset(value: unknown): ExportPreset {
  const raw = String(value || "").trim();
  if (raw === "draft" || raw === "high_quality" || raw === "mobile" || raw === "youtube" || raw === "play_store_preview") return raw;
  return "standard";
}

function outputEncodingArgs(preset: ExportPreset, hasAudio: boolean) {
  const common = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  const audio = hasAudio ? ["-c:a", "aac", "-b:a", preset === "mobile" ? "128k" : "192k"] : ["-an"];

  if (preset === "draft") return [...common, "-preset", "veryfast", "-crf", "28", ...audio];
  if (preset === "high_quality") return [...common, "-preset", "slow", "-crf", "18", ...audio];
  if (preset === "mobile") return [...common, "-preset", "medium", "-crf", "26", ...audio];
  if (preset === "youtube") return [...common, "-preset", "medium", "-crf", "20", ...audio];
  if (preset === "play_store_preview") return [...common, "-preset", "medium", "-crf", "22", ...audio];
  return [...common, "-preset", "medium", "-crf", "23", ...audio];
}

async function stitchWithTransitions(
  videos: Array<{ card: number; videoPath: string }>,
  transitions: NormalizedTransition[],
  outputPath: string,
  exportPreset: ExportPreset
) {
  const durations = await Promise.all(videos.map((video) => probeDuration(video.videoPath)));
  const allInputsHaveAudio = (await Promise.all(videos.map((video) => probeHasAudio(video.videoPath)))).every(Boolean);
  const args: string[] = ["-y"];
  for (const video of videos) args.push("-i", video.videoPath);

  const filters: string[] = [];
  videos.forEach((_, index) => {
    filters.push(`[${index}:v]fps=30,scale=1280:-2,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`);
    if (allInputsHaveAudio) {
      filters.push(
        `[${index}:a]aresample=async=1:first_pts=0,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${index}]`
      );
    }
  });

  let videoLabel = "v0";
  let audioLabel = "a0";
  let timelineSeconds = durations[0] || 0;

  for (let index = 1; index < videos.length; index += 1) {
    const transition = transitions[index - 1] || normalizeTransition(undefined);
    const previousDuration = durations[index - 1] || 1;
    const nextDuration = durations[index] || 1;
    const nextVideoLabel = `vx${index}`;

    if (transition.type === "cut") {
      filters.push(`[${videoLabel}][v${index}]concat=n=2:v=1:a=0[${nextVideoLabel}]`);
      videoLabel = nextVideoLabel;

      if (allInputsHaveAudio) {
        const nextAudioLabel = `ax${index}`;
        filters.push(`[${audioLabel}][a${index}]concat=n=2:v=0:a=1[${nextAudioLabel}]`);
        audioLabel = nextAudioLabel;
      }

      timelineSeconds += nextDuration;
    } else {
      const duration = Math.min(
        transition.durationSeconds,
        Math.max(0.1, previousDuration - 0.1),
        Math.max(0.1, nextDuration - 0.1)
      );
      const offset = Math.max(0, timelineSeconds - duration);

      filters.push(
        `[${videoLabel}][v${index}]xfade=transition=${xfadeName(transition.type)}:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)}[${nextVideoLabel}]`
      );
      videoLabel = nextVideoLabel;

      if (allInputsHaveAudio) {
        const nextAudioLabel = `ax${index}`;
        filters.push(`[${audioLabel}][a${index}]acrossfade=d=${duration.toFixed(3)}:c1=tri:c2=tri[${nextAudioLabel}]`);
        audioLabel = nextAudioLabel;
      }

      timelineSeconds = timelineSeconds + nextDuration - duration;
    }
  }

  args.push("-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`);
  if (allInputsHaveAudio) args.push("-map", `[${audioLabel}]`);
  args.push(...outputEncodingArgs(exportPreset, allInputsHaveAudio), outputPath);

  await runFfmpeg(args);
}

function concatLine(filePath: string) {
  return `file '${filePath.replace(/'/g, "'\\''").replace(/\\/g, "/")}'`;
}

async function readRequestBodyFirst(req: NextRequest) {
  let body: any = {};
  let rawText = "";
  let parser = "none";

  try {
    const jsonClone = req.clone();
    const parsed = await jsonClone.json();
    if (parsed && typeof parsed === "object") {
      body = parsed;
      rawText = JSON.stringify(parsed);
      parser = "clone.json";
    }
  } catch {
    // Try text parse below.
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length === 0) {
    try {
      const textClone = req.clone();
      rawText = await textClone.text();
      parser = "clone.text";

      if (rawText.trim()) {
        const parsed = JSON.parse(rawText);
        if (parsed && typeof parsed === "object") {
          body = parsed;
        }
      }
    } catch {
      // Try original stream as last resort.
    }
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length === 0) {
    try {
      rawText = await req.text();
      parser = "req.text";

      if (rawText.trim()) {
        const parsed = JSON.parse(rawText);
        if (parsed && typeof parsed === "object") {
          body = parsed;
        }
      }
    } catch {
      // Keep empty body.
    }
  }

  if (typeof body === "string" && body.trim()) {
    try {
      body = JSON.parse(body);
      parser = `${parser}:string-json`;
    } catch {
      body = {};
    }
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    body = {};
  }

  return {
    body,
    rawText,
    parser,
  };
}

function arrayFromMaybe(value: unknown): SceneInput[] {
  if (Array.isArray(value)) return value as SceneInput[];

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).filter(
      (item) => item && typeof item === "object"
    ) as SceneInput[];
  }

  return [];
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function basenameOnly(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "http://otg.local");

    const name =
      parsed.searchParams.get("name") ||
      parsed.searchParams.get("filename") ||
      parsed.searchParams.get("fileName") ||
      "";

    if (name) return path.basename(name);

    return path.basename(decodeURIComponent(parsed.pathname || raw));
  } catch {
    return path.basename(raw.replace(/\\/g, "/"));
  }
}

function asString(value: unknown) {
  return String(value || "").trim();
}

function extractUrlPathOrName(value: unknown) {
  const raw = asString(value);
  if (!raw) return { pathValue: "", nameValue: "", urlValue: "" };

  try {
    const parsed = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "http://otg.local");

    const pathValue = asString(parsed.searchParams.get("path"));
    const nameValue = asString(
      parsed.searchParams.get("name") ||
        parsed.searchParams.get("filename") ||
        parsed.searchParams.get("fileName")
    );

    return {
      pathValue,
      nameValue,
      urlValue: raw,
    };
  } catch {
    return {
      pathValue: "",
      nameValue: "",
      urlValue: "",
    };
  }
}

function candidateRoots(ownerKey: string, productionId: string) {
  const owner = safeSegment(ownerKey || "local");
  const production = safeSegment(productionId || "production");

  const roots = [
    path.join(OTG_DATA_ROOT, "productions", owner, production),
    path.join(OTG_DATA_ROOT, "productions", owner),
    path.join(OTG_DATA_ROOT, "productions"),
    path.join(OTG_DATA_ROOT, "gallery"),
    path.join(OTG_DATA_ROOT, "videos"),
    path.join(OTG_DATA_ROOT, "outputs"),
    OTG_DATA_ROOT,
    process.env.OTG_DATA_DIR,
    process.env.DATA_DIR,
    process.env.COMFY_OUTPUT_DIR,
    process.env.COMFYUI_OUTPUT_DIR,
    process.env.OTG_COMFY_OUTPUT_DIR,
    process.env.OTG_VIDEO_OUTPUT_DIR,
    path.join(process.cwd(), "data"),
    path.join(process.cwd(), "public"),
    "E:\\Renders\\ComfyUI",
    "E:\\Renders",
    "C:\\AI\\Comfyui\\output",
    "C:\\AI\\ComfyUI\\output",
    "C:\\AI\\Comfyui\\ComfyUI\\output",
    "C:\\AI\\ComfyUI\\ComfyUI\\output",
    "C:\\AI\\Comfyui\\ComfyUI_windows_portable\\ComfyUI\\output",
    "D:\\AI\\ComfyUI_windows_portable\\ComfyUI\\output",
  ];

  return Array.from(
    new Set(
      roots
        .map((root) => String(root || "").trim())
        .filter(Boolean)
        .map((root) => path.resolve(root))
    )
  );
}

async function findVideoByName(root: string, wantedName: string, maxFiles = 50000) {
  const safeName = path.basename(String(wantedName || "").trim());
  if (!safeName || !VIDEO_EXT_RE.test(safeName)) return "";

  let checked = 0;
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    let entries: any[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!/node_modules|\.next\\cache|_otg_patch_backups/i.test(fullPath)) {
          stack.push(fullPath);
        }
        continue;
      }

      checked += 1;
      if (checked > maxFiles) return "";

      if (!entry.isFile()) continue;
      if (entry.name === safeName) return fullPath;
    }
  }

  return "";
}

function sceneCandidates(scene: SceneInput) {
  const clip = scene?.clip && typeof scene.clip === "object" ? scene.clip : {};

  return [
    scene.videoPath,
    scene.serverPath,
    scene.generatedVideoPath,
    scene.localPath,
    scene.filePath,
    scene.outputPath,
    scene.path,
    scene.url,
    scene.src,
    scene.videoUrl,
    scene.serverUrl,
    scene.generatedVideoUrl,
    scene.fileName,
    scene.filename,
    scene.name,
    scene.sourceName,
    scene.originalFileName,
    scene.editedFileName,

    clip.videoPath,
    clip.serverPath,
    clip.generatedVideoPath,
    clip.localPath,
    clip.filePath,
    clip.outputPath,
    clip.path,
    clip.url,
    clip.src,
    clip.videoUrl,
    clip.serverUrl,
    clip.generatedVideoUrl,
    clip.fileName,
    clip.filename,
    clip.name,
    clip.sourceName,
    clip.originalFileName,
    clip.editedFileName,
  ];
}

function sceneUrlCandidates(scene: SceneInput) {
  const clip = scene?.clip && typeof scene.clip === "object" ? scene.clip : {};

  return [
    scene.videoUrl,
    scene.serverUrl,
    scene.generatedVideoUrl,
    scene.url,
    scene.src,
    clip.videoUrl,
    clip.serverUrl,
    clip.generatedVideoUrl,
    clip.url,
    clip.src,
  ]
    .map(asString)
    .filter(Boolean);
}

function sceneNameCandidates(scene: SceneInput) {
  const clip = scene?.clip && typeof scene.clip === "object" ? scene.clip : {};

  return [
    scene.fileName,
    scene.filename,
    scene.name,
    scene.sourceName,
    scene.originalFileName,
    scene.editedFileName,
    clip.fileName,
    clip.filename,
    clip.name,
    clip.sourceName,
    clip.originalFileName,
    clip.editedFileName,
  ]
    .map(basenameOnly)
    .filter((value) => value && VIDEO_EXT_RE.test(value));
}

async function resolvePathCandidate(value: unknown, roots: string[]) {
  const raw = asString(value);
  if (!raw) return "";

  const extracted = extractUrlPathOrName(raw);
  const directCandidates = [extracted.pathValue, raw]
    .map(asString)
    .filter(Boolean);

  for (const candidate of directCandidates) {
    if (!VIDEO_EXT_RE.test(candidate)) continue;
    if (!path.isAbsolute(candidate)) continue;

    const normalized = path.normalize(candidate);
    if (await fileExists(normalized)) return normalized;
  }

  const names = [extracted.nameValue, basenameOnly(raw)]
    .map(asString)
    .filter((value) => value && VIDEO_EXT_RE.test(value));

  for (const name of names) {
    for (const root of roots) {
      const direct = path.join(root, path.basename(name));
      if (await fileExists(direct)) return direct;

      const found = await findVideoByName(root, name);
      if (found) return found;
    }
  }

  return "";
}

function absoluteAppUrl(req: NextRequest, value: string) {
  const raw = asString(value);
  if (!raw) return "";

  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return raw;
    }

    if (raw.startsWith("/")) {
      return new URL(raw, req.nextUrl.origin).toString();
    }

    return "";
  } catch {
    return "";
  }
}

async function fetchVideoUrlToTemp(req: NextRequest, urlValue: string, card: number, productionId: string) {
  const absoluteUrl = absoluteAppUrl(req, urlValue);
  if (!absoluteUrl) return "";

  const response = await fetch(absoluteUrl, {
    method: "GET",
    cache: "no-store",
    headers: {
      cookie: req.headers.get("cookie") || "",
    },
  });

  if (!response.ok) return "";

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) return "";

  const fromUrl = extractUrlPathOrName(urlValue);
  const inferredName = basenameOnly(fromUrl.nameValue || urlValue);
  const ext = VIDEO_EXT_RE.test(inferredName) ? path.extname(inferredName).toLowerCase() : ".mp4";
  const tempPath = path.join(
    os.tmpdir(),
    `otg_stitch_input_${safeSegment(productionId)}_${String(card).padStart(3, "0")}_${Date.now()}${ext}`
  );

  await fs.writeFile(tempPath, bytes);
  return tempPath;
}

async function fetchVideoNameToTemp(req: NextRequest, name: string, card: number, productionId: string) {
  const cleanName = basenameOnly(name);
  if (!cleanName || !VIDEO_EXT_RE.test(cleanName)) return "";

  const url = `/api/gallery/file?name=${encodeURIComponent(cleanName)}&stitch=1`;
  return fetchVideoUrlToTemp(req, url, card, productionId);
}

async function resolveSceneVideo(
  req: NextRequest,
  scene: SceneInput,
  card: number,
  roots: string[],
  productionId: string
): Promise<ResolvedVideo | null> {
  for (const candidate of sceneCandidates(scene)) {
    const resolved = await resolvePathCandidate(candidate, roots);
    if (resolved) {
      return {
        card,
        videoPath: resolved,
        source: "path",
        debug: { candidate: asString(candidate) },
      };
    }
  }

  for (const urlCandidate of sceneUrlCandidates(scene)) {
    const tempPath = await fetchVideoUrlToTemp(req, urlCandidate, card, productionId).catch(() => "");
    if (tempPath) {
      return {
        card,
        videoPath: tempPath,
        source: "url",
        cleanup: true,
        debug: { urlCandidate },
      };
    }
  }

  for (const nameCandidate of sceneNameCandidates(scene)) {
    const tempPath = await fetchVideoNameToTemp(req, nameCandidate, card, productionId).catch(() => "");
    if (tempPath) {
      return {
        card,
        videoPath: tempPath,
        source: "filename",
        cleanup: true,
        debug: { nameCandidate },
      };
    }
  }

  return null;
}

function sceneDebugKeys(scene: SceneInput) {
  const keys: string[] = [];

  for (const [key, value] of Object.entries(scene || {})) {
    if (typeof value === "string" && value.trim()) keys.push(key);
  }

  const clip = scene?.clip && typeof scene.clip === "object" ? scene.clip : {};
  for (const [key, value] of Object.entries(clip)) {
    if (typeof value === "string" && value.trim()) keys.push(`clip.${key}`);
  }

  return Array.from(new Set(keys)).sort();
}

function dedupeResolvedVideos(items: ResolvedVideo[]) {
  const seen = new Set<string>();
  const out: ResolvedVideo[] = [];

  for (const item of items) {
    const key = path.normalize(item.videoPath).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}


// OTG_PRODUCTION_ASSEMBLE_BACKGROUND_AUDIO_STITCH_V1_START
function productionAudioExt(value: string) {
  const match = String(value || "").match(/\.(mp3|wav|m4a|aac|ogg|flac|webm)(?:$|[?#])/i);
  return match ? `.${match[1].toLowerCase()}` : ".mp3";
}

function productionBackgroundAudioConfig(body: any) {
  const raw = body?.backgroundAudio || body?.assembleBackgroundAudio || {};
  const mode = String(raw?.mode || "keep").trim().toLowerCase();

  return {
    mode: ["keep", "remove", "replace", "mix"].includes(mode) ? mode : "keep",
    audioPath: String(raw?.audioPath || raw?.path || raw?.filePath || "").trim(),
    audioUrl: String(raw?.audioUrl || raw?.url || raw?.fileUrl || "").trim(),
    fileName: String(raw?.fileName || raw?.filename || raw?.name || "").trim(),
    volume: Math.max(0, Math.min(1.5, Number(raw?.volume ?? 0.28) || 0)),
    originalVolume: Math.max(0, Math.min(1.5, Number(raw?.originalVolume ?? 1) || 0)),
    loop: raw?.loop !== false,
  };
}

function productionPathFromFileUrl(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "http://otg.local");

    if (parsed.pathname !== "/api/file") return "";
    return String(parsed.searchParams.get("path") || "").trim();
  } catch {
    return "";
  }
}

async function fetchProductionBackgroundAudioToFile(req: NextRequest, urlValue: string, outputDir: string) {
  const raw = String(urlValue || "").trim();
  if (!raw) return "";

  const absoluteUrl = raw.startsWith("http://") || raw.startsWith("https://")
    ? raw
    : new URL(raw, req.nextUrl.origin).toString();

  const response = await fetch(absoluteUrl, {
    method: "GET",
    cache: "no-store",
    headers: {
      cookie: req.headers.get("cookie") || "",
    },
  });

  if (!response.ok) return "";

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) return "";

  const ext = productionAudioExt(raw);
  const audioPath = path.join(outputDir, `background_audio_input_${Date.now()}${ext}`);
  await fs.writeFile(audioPath, bytes);
  return audioPath;
}

async function resolveProductionBackgroundAudio(req: NextRequest, config: ReturnType<typeof productionBackgroundAudioConfig>, outputDir: string) {
  const candidates = [config.audioPath, productionPathFromFileUrl(config.audioUrl)]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && fssync.existsSync(candidate)) return path.normalize(candidate);
  }

  if (config.audioUrl) {
    const downloaded = await fetchProductionBackgroundAudioToFile(req, config.audioUrl, outputDir);
    if (downloaded) return downloaded;
  }

  if (config.fileName) {
    const downloaded = await fetchProductionBackgroundAudioToFile(req, `/api/gallery/file?name=${encodeURIComponent(config.fileName)}`, outputDir);
    if (downloaded) return downloaded;
  }

  return "";
}

async function applyProductionAssembleBackgroundAudio(req: NextRequest, body: any, inputVideoPath: string, outputDir: string) {
  const config = productionBackgroundAudioConfig(body);

  if (config.mode === "keep") {
    return {
      videoPath: inputVideoPath,
      videoUrl: fileUrlFor(inputVideoPath),
      backgroundAudio: { mode: "keep", applied: false },
    };
  }

  const finalPath = path.join(outputDir, `stitched_audio_${Date.now()}.mp4`);

  if (config.mode === "remove") {
    await runFfmpeg(["-y", "-i", inputVideoPath, "-map", "0:v:0", "-c:v", "copy", "-an", finalPath]);
    return {
      videoPath: finalPath,
      videoUrl: fileUrlFor(finalPath),
      backgroundAudio: { mode: "remove", applied: true },
    };
  }

  const audioPath = await resolveProductionBackgroundAudio(req, config, outputDir);
  if (!audioPath) throw new Error("Background audio mode requires an uploaded, generated, sampled, or gallery audio source.");

  const loopArgs = config.loop ? ["-stream_loop", "-1"] : [];

  if (config.mode === "replace") {
    await runFfmpeg([
      "-y",
      "-i",
      inputVideoPath,
      ...loopArgs,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-shortest",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      finalPath,
    ]);

    return {
      videoPath: finalPath,
      videoUrl: fileUrlFor(finalPath),
      backgroundAudio: { mode: "replace", applied: true, audioPath },
    };
  }

  try {
    await runFfmpeg([
      "-y",
      "-i",
      inputVideoPath,
      ...loopArgs,
      "-i",
      audioPath,
      "-filter_complex",
      `[0:a]volume=${config.originalVolume}[a0];[1:a]volume=${config.volume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]`,
      "-map",
      "0:v:0",
      "-map",
      "[a]",
      "-shortest",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      finalPath,
    ]);
  } catch {
    await runFfmpeg([
      "-y",
      "-i",
      inputVideoPath,
      ...loopArgs,
      "-i",
      audioPath,
      "-filter_complex",
      `[1:a]volume=${config.volume}[a]`,
      "-map",
      "0:v:0",
      "-map",
      "[a]",
      "-shortest",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      finalPath,
    ]);
  }

  return {
    videoPath: finalPath,
    videoUrl: fileUrlFor(finalPath),
    backgroundAudio: {
      mode: "mix",
      applied: true,
      audioPath,
      volume: config.volume,
      originalVolume: config.originalVolume,
    },
  };
}
// OTG_PRODUCTION_ASSEMBLE_BACKGROUND_AUDIO_STITCH_V1_END

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();

  const tempFiles: string[] = [];

  /*
    Critical ordering:
    Read/clone the request body before owner/session helpers. If any helper touches
    the stream first, req.text()/req.json() later can become empty even though the
    browser sent a valid JSON payload.
  */
  const { body, rawText, parser } = await readRequestBodyFirst(req);

  try {
    const owner = await getOwnerContext(req);
    const ownerKey = owner.ownerKey;

    const productionId = safeSegment(String(body?.productionId || "production").trim() || "production");
    const transitions = transitionsFromBody(body);
    const exportPreset = normalizeExportPreset(body?.exportPreset || body?.preset);
    const roots = candidateRoots(ownerKey || "local", productionId);

    const scenes = arrayFromMaybe(
      body?.scenes ??
        body?.clips ??
        body?.items ??
        body?.timeline ??
        body?.payload?.scenes ??
        body?.payload?.clips ??
        body?.data?.scenes ??
        body?.data?.clips ??
        []
    );

    const mapped = await Promise.all(
      scenes.map(async (scene, index) => {
        const card = Math.max(
          1,
          Number(scene?.card ?? scene?.clipIndex ?? scene?.index ?? index + 1) || index + 1
        );

        const resolved = await resolveSceneVideo(req, scene, card, roots, productionId);
        if (resolved?.cleanup) tempFiles.push(resolved.videoPath);

        return {
          card,
          resolved,
          availableStringFields: sceneDebugKeys(scene),
          names: sceneNameCandidates(scene),
          urls: sceneUrlCandidates(scene),
        };
      })
    );

    const orderedVideos = dedupeResolvedVideos(
      mapped
        .map((item) => item.resolved)
        .filter((item): item is ResolvedVideo => Boolean(item))
        .sort((a, b) => a.card - b.card)
    );

    if (!orderedVideos.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "At least one completed scene video is required.",
          receivedScenes: scenes.length,
          resolvedScenes: 0,
          unresolvedScenes: mapped.map((item) => ({
            card: item.card,
            availableStringFields: item.availableStringFields,
            names: item.names,
            urls: item.urls,
          })),
          requestDebug: {
            parser,
            contentType: req.headers.get("content-type") || "",
            contentLength: req.headers.get("content-length") || "",
            rawBodyLength: rawText.length,
            rawBodyPrefix: rawText.slice(0, 240),
            bodyKeys: Object.keys(body || {}),
            productionId,
          },
          searchedRoots: roots,
        },
        { status: 400 }
      );
    }

    const outputDir = path.join(OTG_DATA_ROOT, "productions", safeSegment(ownerKey || "local"), productionId, "stitched");
    await ensureDir(outputDir);

    const outputPath = path.join(outputDir, `stitched_${Date.now()}.mp4`);
    const activeTransitions = transitions.slice(0, Math.max(0, orderedVideos.length - 1));
    const renderedTransitionCount = activeTransitions.filter((transition) => transition.type !== "cut").length;

    if (orderedVideos.length === 1) {
      if (exportPreset === "standard") {
        await fs.copyFile(orderedVideos[0].videoPath, outputPath);
      } else {
        const hasAudio = await probeHasAudio(orderedVideos[0].videoPath).catch(() => false);
        await runFfmpeg(["-y", "-i", orderedVideos[0].videoPath, ...outputEncodingArgs(exportPreset, hasAudio), outputPath]);
      }
    } else if (renderedTransitionCount > 0) {
      await stitchWithTransitions(orderedVideos, activeTransitions, outputPath, exportPreset);
    } else {
      const listPath = path.join(os.tmpdir(), `otg_stitch_${productionId}_${Date.now()}.txt`);
      await fs.writeFile(listPath, orderedVideos.map((item) => concatLine(item.videoPath)).join("\n"), "utf8");

      try {
        if (exportPreset === "standard") {
          await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
        } else {
          const hasAudio = (await Promise.all(orderedVideos.map((item) => probeHasAudio(item.videoPath).catch(() => false)))).every(Boolean);
          await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, ...outputEncodingArgs(exportPreset, hasAudio), outputPath]);
        }
      } catch {
        await runFfmpeg([
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          ...outputEncodingArgs(exportPreset, true),
          outputPath,
        ]);
      } finally {
        await fs.rm(listPath, { force: true }).catch(() => undefined);
      }
    }

    if (!fssync.existsSync(outputPath)) {
      return NextResponse.json({ ok: false, error: "Stitch failed: output file was not created." }, { status: 500 });
    }

    const finalOutput = await applyProductionAssembleBackgroundAudio(req, body, outputPath, outputDir);

    return NextResponse.json({
      ok: true,
      videoPath: finalOutput.videoPath,
      videoUrl: finalOutput.videoUrl,
      sceneCount: orderedVideos.length,
      receivedScenes: scenes.length,
      resolvedScenes: orderedVideos.length,
      backgroundAudio: finalOutput.backgroundAudio,
      transitionsApplied: renderedTransitionCount,
      transitionTypes: activeTransitions.map((transition) => transition.type),
      exportPreset,
      fallbackUsed: false,
      resolvedSources: orderedVideos.map((item) => ({
        card: item.card,
        source: item.source,
        file: path.basename(item.videoPath),
      })),
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ ok: false, error: error?.message || "Stitch failed" }, { status: 500 });
  } finally {
    await Promise.all(tempFiles.map((file) => fs.rm(file, { force: true }).catch(() => undefined)));
  }
}
