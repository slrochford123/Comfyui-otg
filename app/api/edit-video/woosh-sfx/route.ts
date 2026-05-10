import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { configuredVideoComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getGallerySourcesForRequest, resolveGalleryItemByName } from "@/lib/gallery";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import { getFfmpegVersion, resolveFfmpegPath, resolveFfprobePath, runCmd } from "@/lib/ffmpeg";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type HistoryFile = {
  filename: string;
  subfolder?: string;
  type?: string;
  nodeId?: string;
};

type InputVideo = {
  path: string;
  label: string;
  title: string;
  source: string;
};

type ProbeInfo = {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|avi)$/i;
const POLL_MAX_MS = Math.max(60_000, Number(process.env.OTG_EDIT_VIDEO_WOOSH_MAX_MS || 15 * 60 * 1000));
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.OTG_EDIT_VIDEO_WOOSH_POLL_MS || 1500));
const VIEW_MAX_ATTEMPTS = Math.max(3, Number(process.env.OTG_EDIT_VIDEO_WOOSH_VIEW_MAX_ATTEMPTS || 12));
const VIEW_RETRY_MS = Math.max(750, Number(process.env.OTG_EDIT_VIDEO_WOOSH_VIEW_RETRY_MS || 1250));

class StageError extends Error {
  stage: string;
  status?: number;
  detail?: unknown;

  constructor(stage: string, message: string, status?: number, detail?: unknown) {
    super(message);
    this.name = "StageError";
    this.stage = stage;
    this.status = status;
    this.detail = detail;
  }
}

function firstText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(raw: string) {
  return String(raw || "").trim().replace(/\/+$/, "");
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function cleanFileName(value: string, fallback: string): string {
  const base = path.basename(String(value || fallback)).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return base || fallback;
}

function cleanOutputBase(value: string) {
  const withoutExt = path.basename(String(value || "woosh_sound_effects"), path.extname(String(value || "")) || undefined);
  const clean = withoutExt.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_").replace(/\s+/g, " ").trim();
  return (clean || "woosh_sound_effects").slice(0, 90);
}

function editVideoJobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "edit_video_jobs", safeSegment(ownerKey || "local"));
}

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

async function fetchStage(url: string, init: RequestInit, stage: string, timeoutMs: number) {
  const { signal, cancel } = timeoutSignal(timeoutMs);
  try {
    return await fetch(url, { ...init, signal, cache: "no-store" });
  } catch (error: any) {
    const message = error?.name === "AbortError" ? `Request timed out after ${timeoutMs}ms.` : String(error?.message || error);
    throw new StageError(stage, message);
  } finally {
    cancel();
  }
}

async function readJsonOrText(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) return { json: null, text: "" };
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function basenameOnly(value: string) {
  return String(value || "").replace(/\\/g, "/").split("/").pop() || String(value || "");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    const key = process.platform === "win32" ? raw.toLowerCase() : raw;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function configuredComfyOutputRoots() {
  const envRoots = String(process.env.OTG_GALLERY_IMPORT_ROOTS || "")
    .split(/[;\n,]+/)
    .map((v) => v.trim())
    .filter(Boolean);

  return uniqueStrings([
    process.env.COMFY_OUTPUT_DIR || null,
    process.env.ADMIN_GALLERY_ROOT || null,
    ...envRoots,
    "E:/Renders/ComfyUI",
  ])
    .map((root) => path.resolve(root))
    .filter((root) => {
      try {
        return fs.existsSync(root) && fs.statSync(root).isDirectory();
      } catch {
        return false;
      }
    });
}

function outputRelativeCandidates(file: HistoryFile) {
  const rawFilename = String(file.filename || "").trim().replace(/\\/g, "/");
  const rawSubfolder = String(file.subfolder || "").trim().replace(/\\/g, "/");
  const filenameBase = path.basename(rawFilename);

  const candidates = uniqueStrings([
    rawSubfolder && filenameBase ? `${rawSubfolder}/${filenameBase}` : null,
    rawSubfolder && rawFilename ? `${rawSubfolder}/${rawFilename}` : null,
    rawFilename,
    filenameBase,
  ]);

  return candidates.map((rel) => rel.replace(/\//g, path.sep));
}

function resolveExistingComfyOutputPath(file: HistoryFile) {
  const roots = configuredComfyOutputRoots();
  const candidates = outputRelativeCandidates(file);

  for (const root of roots) {
    for (const rel of candidates) {
      const abs = path.resolve(root, rel);
      const relative = path.relative(root, abs);
      const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
      if (!inside) continue;
      try {
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
      } catch {}
    }
  }
  return "";
}

function collectHistoryFiles(value: any, out: HistoryFile[] = [], currentNodeId?: string): HistoryFile[] {
  if (Array.isArray(value)) {
    for (const item of value) collectHistoryFiles(item, out, currentNodeId);
    return out;
  }
  if (value && typeof value === "object") {
    const filename = typeof value.filename === "string" ? value.filename : "";
    if (filename) {
      out.push({
        filename,
        subfolder: typeof value.subfolder === "string" ? value.subfolder : "",
        type: typeof value.type === "string" ? value.type : "output",
        nodeId: currentNodeId,
      });
    }
    for (const [key, child] of Object.entries<any>(value)) {
      collectHistoryFiles(child, out, /^\d+$/.test(String(key)) ? String(key) : currentNodeId);
    }
  }
  return out;
}

function scoreHistoryFile(item: HistoryFile, expectedPrefix?: string) {
  let score = 0;
  const name = String(item.filename || "").toLowerCase();
  if (expectedPrefix) {
    const prefix = String(expectedPrefix).toLowerCase();
    if (name.startsWith(prefix)) score += 100;
    else if (name.includes(prefix)) score += 75;
  }
  if (item.nodeId === "33") score += 50;
  if (VIDEO_EXT_RE.test(name)) score += 20;
  if (name.includes("woosh") || name.includes("sfx")) score += 10;
  return score;
}

function pickVideoHistoryFile(historyJson: any, expectedPrefix?: string) {
  const all = collectHistoryFiles(historyJson, []).filter((item) => VIDEO_EXT_RE.test(item.filename));
  if (!all.length) return null;
  return all.slice().sort((a, b) => scoreHistoryFile(b, expectedPrefix) - scoreHistoryFile(a, expectedPrefix))[0] || null;
}

async function pollHistoryForVideo(baseUrl: string, promptId: string, expectedPrefix?: string) {
  const started = Date.now();
  let lastPayload: any = null;

  while (Date.now() - started < POLL_MAX_MS) {
    const res = await fetchStage(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, "poll_history", 25_000);
    const parsed = await readJsonOrText(res);
    if (res.ok && parsed.json) {
      lastPayload = parsed.json;
      const promptBlock = (parsed.json as any)?.[promptId] ?? parsed.json;
      const hit = pickVideoHistoryFile(promptBlock, expectedPrefix);
      if (hit) return { file: hit, historyPayload: parsed.json };
    }

    const allRes = await fetchStage(`${baseUrl}/history`, { method: "GET" }, "poll_history_all", 25_000);
    const allParsed = await readJsonOrText(allRes);
    if (allRes.ok && allParsed.json) {
      lastPayload = allParsed.json;
      const block = (allParsed.json as any)?.[promptId];
      const hit = pickVideoHistoryFile(block, expectedPrefix);
      if (hit) return { file: hit, historyPayload: allParsed.json };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new StageError("poll_history", `Timed out waiting for Sony Woosh video output for prompt ${promptId}.`, 504, lastPayload);
}

async function fetchViewBinary(baseUrl: string, file: HistoryFile) {
  const params = new URLSearchParams();
  params.set("filename", file.filename);
  if (file.subfolder) params.set("subfolder", file.subfolder);
  if (file.type) params.set("type", file.type);

  let lastStatus = 0;
  let lastDetail: any = null;

  for (let attempt = 1; attempt <= VIEW_MAX_ATTEMPTS; attempt += 1) {
    const res = await fetchStage(`${baseUrl}/view?${params.toString()}`, { method: "GET" }, "fetch_view", 60_000);
    if (res.ok) {
      return Buffer.from(await res.arrayBuffer());
    }
    lastStatus = res.status;
    lastDetail = await readJsonOrText(res);
    await sleep(VIEW_RETRY_MS);
  }

  throw new StageError("fetch_view", `Failed to fetch generated Sony Woosh video after ${VIEW_MAX_ATTEMPTS} attempts.`, lastStatus, lastDetail?.json ?? lastDetail?.text);
}

async function copyOrFetchComfyVideo(baseUrl: string, file: HistoryFile, outPath: string) {
  const existing = resolveExistingComfyOutputPath(file);
  if (existing) {
    await fsp.copyFile(existing, outPath);
  } else {
    const bytes = await fetchViewBinary(baseUrl, file);
    await fsp.writeFile(outPath, bytes);
  }
}

async function probeVideo(filePath: string): Promise<ProbeInfo> {
  const ffprobe = resolveFfprobePath();
  const result = await runCmd(
    ffprobe,
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
    { timeoutMs: 30000 },
  );

  if (result.code !== 0) {
    throw new Error(`ffprobe failed for ${path.basename(filePath)}: ${result.stderr || result.stdout}`);
  }

  const parsed = JSON.parse(result.stdout || "{}");
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const video = streams.find((stream: any) => stream?.codec_type === "video") || {};
  const audio = streams.find((stream: any) => stream?.codec_type === "audio");
  const durationRaw = Number(video?.duration || parsed?.format?.duration || 0);

  return {
    durationSeconds: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 5,
    width: Math.max(2, Number(video?.width || 1280) || 1280),
    height: Math.max(2, Number(video?.height || 720) || 720),
    hasAudio: Boolean(audio),
  };
}

async function resolveInputVideo(args: {
  form: FormData;
  sources: Awaited<ReturnType<typeof getGallerySourcesForRequest>>["sources"];
  inputDir: string;
}): Promise<InputVideo> {
  const source = firstText(args.form.get("video_source"));
  const title = firstText(args.form.get("video_title")) || "Selected video";

  if (source === "upload") {
    const value = args.form.get("video_file");
    if (!(value instanceof File)) {
      throw new Error("Missing uploaded video.");
    }
    const inputName = cleanFileName(value.name || "uploaded_video.mp4", "uploaded_video.mp4");
    const inputPath = safeJoin(args.inputDir, inputName);
    const buffer = Buffer.from(await value.arrayBuffer());
    await fsp.writeFile(inputPath, buffer);
    return { path: inputPath, label: inputName, title, source: "upload" };
  }

  if (source === "gallery") {
    const name = firstText(args.form.get("video_name"));
    const scope = firstText(args.form.get("video_scope"));
    const item = resolveGalleryItemByName({ sources: args.sources, name, scopeHint: scope || null });
    if (!item || item.kind !== "video") {
      throw new Error("Gallery video not found.");
    }
    return { path: item.path, label: item.name || path.basename(item.path), title, source: "gallery" };
  }

  throw new Error("Choose a video first.");
}

function modelConfig(model: string) {
  const fast = String(model || "vflow").toLowerCase() === "dvflow";
  return {
    modelName: fast ? "Woosh-DVFlow-8s" : "Woosh-VFlow-8s",
    modelType: fast ? "DVFlow" : "VFlow",
    steps: fast ? 4 : 50,
    cfg: fast ? 1.0 : 4.5,
    mode: fast ? "dvflow" : "vflow",
  };
}

const WOOSH_WORKFLOW_TEMPLATE_PATH = path.join(
  process.cwd(),
  "comfy_workflows",
  "internal",
  "edit-video",
  "sony_woosh_v2a.json",
);

async function uploadLocalVideoToComfyInput(args: { videoPath: string; comfyBaseUrl: string; label: string }) {
  const buffer = await fsp.readFile(args.videoPath);
  const safeName = cleanFileName(args.label || path.basename(args.videoPath) || "woosh_source_video.mp4", "woosh_source_video.mp4");
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)]), safeName);
  form.append("overwrite", "true");
  form.append("type", "input");

  const res = await fetchStage(
    `${args.comfyBaseUrl}/upload/image`,
    { method: "POST", body: form },
    "upload_video_to_comfy",
    60_000,
  );
  const parsed = await readJsonOrText(res);
  if (!res.ok) {
    throw new StageError("upload_video_to_comfy", `ComfyUI video upload failed (${res.status}).`, res.status, parsed.json || parsed.text);
  }

  const json: any = parsed.json || {};
  const name = json.name || json.filename || safeName;
  const rawSubfolder = json.subfolder ? String(json.subfolder) : "";
  const subfolder = rawSubfolder
    .split(String.fromCharCode(92))
    .join("/")
    .split("/")
    .filter(Boolean)
    .join("/");
  return subfolder ? `${subfolder}/${String(name)}` : String(name);
}

function loadWooshWorkflowTemplate() {
  const raw = fs.readFileSync(WOOSH_WORKFLOW_TEMPLATE_PATH, "utf8");
  const graph: any = JSON.parse(raw);
  delete graph.__otg;

  const required: Array<[string, string]> = [
    ["7", "WooshLoadFlow"],
    ["19", "WooshTextEncode"],
    ["33", "VHS_VideoCombine"],
    ["34", "VHS_LoadVideo"],
    ["37", "WooshLoadVideo"],
    ["38", "WooshSample"],
  ];

  for (const [nodeId, classType] of required) {
    if (!graph[nodeId]) throw new Error(`Woosh workflow template missing node ${nodeId} (${classType}).`);
    if (graph[nodeId].class_type !== classType) {
      throw new Error(`Woosh workflow node ${nodeId} expected ${classType} but found ${graph[nodeId].class_type}.`);
    }
  }

  // The uploaded reference graph can include optional Qwen keyword helper nodes.
  // The OTG UI supplies its own SFX prompt, so remove those nodes to avoid optional-node dependency failures.
  delete graph["45"];
  delete graph["46"];
  delete graph["9"];

  return graph;
}

function buildWooshGraph(params: {
  videoInputName: string;
  prompt: string;
  model: string;
  durationSeconds: number;
  seed: number;
  filenamePrefix: string;
}) {
  const graph: any = loadWooshWorkflowTemplate();
  const cfg = modelConfig(params.model);
  const wooshMaxSeconds = Math.max(1, Number(process.env.OTG_WOOSH_MAX_SECONDS || 8) || 8);
  const duration = clamp(Number(params.durationSeconds) || 8, 1, wooshMaxSeconds);
  const frameLoadCap = Math.max(1, Math.floor(duration * 25) + 1);
  const latentFrames = Math.max(100, Math.floor(duration * 100) + 1);
  const seed = Number.isFinite(params.seed) && params.seed >= 0 ? Math.floor(params.seed) : Math.floor(Math.random() * 2147483647);

  graph["7"].inputs.model_name = cfg.modelName;
  graph["7"].inputs.model_type = cfg.modelType;

  graph["19"].inputs.mode = "V2A — video to audio (VFlow/DVFlow)";

  graph["34"].inputs.video = params.videoInputName;
  graph["34"].inputs.force_rate = 25;
  graph["34"].inputs.custom_width = 0;
  graph["34"].inputs.custom_height = 0;
  graph["34"].inputs.frame_load_cap = frameLoadCap;
  graph["34"].inputs.skip_first_frames = 0;
  graph["34"].inputs.select_every_nth = 1;
  graph["34"].inputs.format = "LTXV";

  graph["37"].inputs.video_path = "";
  graph["37"].inputs.max_duration_s = duration;
  graph["37"].inputs.image_batch = ["34", 0];

  graph["38"].inputs.prompt = params.prompt;
  graph["38"].inputs.steps = cfg.steps;
  graph["38"].inputs.cfg = cfg.cfg;
  graph["38"].inputs.seed = seed;
  graph["38"].inputs.latent_frames = latentFrames;
  graph["38"].inputs.subprocess = false;
  graph["38"].inputs.force_offload = false;
  graph["38"].inputs.gen_model = ["7", 0];
  graph["38"].inputs.text_conditioning = ["19", 0];
  graph["38"].inputs.video = ["37", 0];

  graph["33"].inputs.frame_rate = 25;
  graph["33"].inputs.filename_prefix = params.filenamePrefix;
  graph["33"].inputs.format = "video/h264-mp4";
  graph["33"].inputs.pix_fmt = "yuv420p";
  graph["33"].inputs.crf = 19;
  graph["33"].inputs.save_metadata = true;
  graph["33"].inputs.trim_to_audio = false;
  graph["33"].inputs.pingpong = false;
  graph["33"].inputs.save_output = true;
  graph["33"].inputs.images = ["38", 0];
  graph["33"].inputs.audio = ["38", 1];

  return graph;
}

async function mixOriginalWithSfx(args: {
  inputVideoPath: string;
  wooshVideoPath: string;
  outputPath: string;
  durationSeconds: number;
  keepOriginalAudio: boolean;
  originalVolume: number;
  sfxVolume: number;
}) {
  const ffmpeg = resolveFfmpegPath();
  const probeInput = await probeVideo(args.inputVideoPath);
  const probeSfx = await probeVideo(args.wooshVideoPath);
  const requestedDuration = Number(args.durationSeconds) || probeInput.durationSeconds || 8;
  const duration = clamp(
    Math.min(requestedDuration, probeInput.durationSeconds || requestedDuration, probeSfx.durationSeconds || requestedDuration),
    0.2,
    Math.max(0.2, requestedDuration),
  );
  const useOriginal = args.keepOriginalAudio && probeInput.hasAudio;

  const cmdArgs: string[] = ["-y", "-hide_banner", "-i", args.inputVideoPath, "-i", args.wooshVideoPath];
  if (useOriginal) {
    cmdArgs.push(
      "-filter_complex",
      `[0:a:0]volume=${args.originalVolume}[a0];[1:a:0]volume=${args.sfxVolume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]`,
      "-map",
      "0:v:0",
      "-map",
      "[a]",
    );
  } else {
    cmdArgs.push("-filter_complex", `[1:a:0]volume=${args.sfxVolume}[a]`, "-map", "0:v:0", "-map", "[a]");
  }

  cmdArgs.push(
    "-t",
    String(duration),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    args.outputPath,
  );

  const result = await runCmd(ffmpeg, cmdArgs, { timeoutMs: 20 * 60 * 1000 });
  if (result.code !== 0) {
    throw new Error(`FFmpeg Woosh audio mix failed: ${result.stderr || result.stdout}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ffmpegVersion = await getFfmpegVersion();
    if (!ffmpegVersion) {
      return NextResponse.json({ ok: false, error: "ffmpeg not available" }, { status: 500 });
    }

    const form = await req.formData();
    const prompt = firstText(form.get("prompt"));
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Sound-effects prompt is required." }, { status: 400 });
    }

    const model = firstText(form.get("model")) === "dvflow" ? "dvflow" : "vflow";
    const requestedDurationSeconds = Number(firstText(form.get("durationSeconds")));
    const rawSeed = Number(firstText(form.get("seed")));
    const seed = Number.isFinite(rawSeed) && rawSeed >= 0 ? Math.floor(rawSeed) : Math.floor(Math.random() * 2147483647);
    const keepOriginalAudio = firstText(form.get("keepOriginalAudio")) === "1";
    const originalVolume = clamp(Number(firstText(form.get("originalVolume"))) || 1, 0, 1.5);
    const sfxVolume = clamp(Number(firstText(form.get("sfxVolume"))) || 0.7, 0, 1.5);
    const requestedTitle = cleanOutputBase(firstText(form.get("title")) || "woosh_sound_effects");
    const outputFileName = `${requestedTitle}.mp4`;

    const { owner, sources } = await getGallerySourcesForRequest(req);
    const jobId = randomUUID();
    const jobDir = path.join(editVideoJobRoot(owner.ownerKey), jobId);
    const inputDir = path.join(jobDir, "inputs");
    ensureDir(inputDir);

    const inputVideo = await resolveInputVideo({ form, sources, inputDir });

    // OTG_WOOSH_VIDEO_LENGTH_DURATION: derive Sony Woosh SFX duration from the selected source video.
    // Default remains capped by the 8-second VFlow/DVFlow model family unless OTG_WOOSH_MAX_SECONDS is raised.
    const inputProbeForDuration = await probeVideo(inputVideo.path);
    const sourceDurationSeconds =
      Number.isFinite(inputProbeForDuration.durationSeconds) && inputProbeForDuration.durationSeconds > 0
        ? inputProbeForDuration.durationSeconds
        : 8;
    const wooshMaxSeconds = Math.max(1, Number(process.env.OTG_WOOSH_MAX_SECONDS || 8) || 8);
    const durationSeconds = clamp(
      Number.isFinite(requestedDurationSeconds) && requestedDurationSeconds > 0
        ? Math.min(requestedDurationSeconds, sourceDurationSeconds)
        : sourceDurationSeconds,
      1,
      wooshMaxSeconds,
    );
    const durationWasCapped = durationSeconds < sourceDurationSeconds;
    const comfyBaseUrl = normalizeBaseUrl(configuredVideoComfyBaseUrl() || "http://127.0.0.1:8188");
    const clientId = `otg_edit_video_woosh_${Date.now()}`;
    const prefixBase = `Woosh/otg_woosh_${Date.now()}_${requestedTitle}`;
    const comfyInputVideoName = await uploadLocalVideoToComfyInput({
      videoPath: inputVideo.path,
      comfyBaseUrl,
      label: inputVideo.label,
    });

    const graph = buildWooshGraph({
      videoInputName: comfyInputVideoName,
      prompt,
      model,
      durationSeconds,
      seed,
      filenamePrefix: prefixBase,
    });

    const submit = await fetchStage(
      `${comfyBaseUrl}/prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: graph, client_id: clientId }),
      },
      "submit_prompt",
      60_000,
    );

    const submitParsed = await readJsonOrText(submit);
    if (!submit.ok || !submitParsed.json?.prompt_id) {
      throw new StageError("submit_prompt", submitParsed.json?.error || `ComfyUI did not return a prompt_id (${submit.status}).`, submit.status, submitParsed.json || submitParsed.text);
    }

    const promptId = String(submitParsed.json.prompt_id);
    const historyHit = await pollHistoryForVideo(comfyBaseUrl, promptId, path.basename(prefixBase));
    const remoteWooshPath = path.join(jobDir, "woosh_raw.mp4");
    await copyOrFetchComfyVideo(comfyBaseUrl, historyHit.file, remoteWooshPath);

    const outputPath = path.join(jobDir, outputFileName);
    await mixOriginalWithSfx({
      inputVideoPath: inputVideo.path,
      wooshVideoPath: remoteWooshPath,
      outputPath,
      durationSeconds,
      keepOriginalAudio,
      originalVolume,
      sfxVolume,
    });

    const finalProbe = await probeVideo(outputPath);
    const stat = fs.statSync(outputPath);

    return NextResponse.json({
      ok: true,
      jobId,
      promptId,
      fileName: outputFileName,
      url: `/api/edit-video/file?jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(outputFileName)}`,
      durationSeconds: finalProbe.durationSeconds,
      sfxDurationSeconds: durationSeconds,
      sourceDurationSeconds,
      durationWasCapped,
      wooshMaxSeconds,
      sizeBytes: stat.size,
      width: finalProbe.width,
      height: finalProbe.height,
      prompt,
      model,
      seed,
      keepOriginalAudio,
      originalVolume,
      sfxVolume,
      videoName: inputVideo.label,
      remoteFile: historyHit.file,
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const stage = error instanceof StageError ? error.stage : "woosh_sfx";
    const status = error instanceof StageError && error.status ? error.status : 500;
    const detail = error instanceof StageError ? error.detail : undefined;
    return NextResponse.json({ ok: false, error: error?.message || "Sony Woosh sound-effects generation failed.", stage, detail }, { status });
  }
}
