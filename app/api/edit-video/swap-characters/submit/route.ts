import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";

import { configuredVideoComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import {
  buildSwapPlan,
  buildSwapPlanFromForm,
  type SwapMapping,
  type SwapPlanRequest,
} from "@/lib/editVideoSwapCharacters";
import { clearGalleryListCache, getGallerySourcesForRequest, resolveGalleryItemByName, safeGalleryName, writeMetaForFile, type GallerySource } from "@/lib/gallery";
import { warmGalleryThumb } from "@/lib/galleryThumbs";
import { createH3DirectJob, h3DirectPublicStatus, startH3DirectJob, validateH3DirectInput, type H3DirectReference } from "@/lib/h3DirectJobs";
import { H3_REFERENCE_VIDEO_CLIP_SECONDS, trimH3ReferenceVideoClip } from "@/lib/h3ReferenceVideoClip";
import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { OTG_DATA_ROOT, ensureDir, safeJoin, safeSegment } from "@/lib/paths";
import type { H3ProductionDuration } from "@/lib/production/h3ProductionRecipes";
import { submitComfyPromptWithGpuLease } from "@/lib/workers/comfyPromptLease";
import { probeVideoInfo } from "@/lib/videoFrame";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { scailSourceObjectIndex, scailFramePlan } from "@/lib/scailRuntime";
import { runtimePath } from "@/lib/runtime/configPaths";

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
  clipStartSeconds?: number;
  clipDurationSeconds?: number;
  sourceDurationSeconds?: number;
};

const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|avi)$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic)$/i;
const POLL_MAX_MS = Math.max(60_000, Number(process.env.OTG_EDIT_VIDEO_SWAP_CHARACTERS_MAX_MS || 60 * 60 * 1000));
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.OTG_EDIT_VIDEO_SWAP_CHARACTERS_POLL_MS || 2500));
const VIEW_RETRY_MS = Math.max(750, Number(process.env.OTG_EDIT_VIDEO_SWAP_CHARACTERS_VIEW_RETRY_MS || 1250));

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

function normalizeBaseUrl(raw: string) {
  return String(raw || "").trim().replace(/\/+$/, "");
}

function basenameOnly(value: string) {
  return String(value || "").replace(/\\/g, "/").split("/").pop() || String(value || "");
}

function cleanFileName(value: string, fallback: string): string {
  const base = path.basename(String(value || fallback)).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return base || fallback;
}

function editVideoJobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "edit_video_jobs", safeSegment(ownerKey || "local"));
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
    process.env.OTG_COMFY_OUTPUT_DIR || null,
    process.env.ADMIN_GALLERY_ROOT || null,
    ...envRoots,
    "/mnt/otg_fast/comfyui/output",
    runtimePath("comfy", "output"),
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

function collectHistoryFiles(value: unknown, out: HistoryFile[] = [], currentNodeId?: string): HistoryFile[] {
  if (Array.isArray(value)) {
    for (const item of value) collectHistoryFiles(item, out, currentNodeId);
    return out;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const filename = typeof record.filename === "string" ? record.filename : "";
    if (filename) {
      out.push({
        filename,
        subfolder: typeof record.subfolder === "string" ? record.subfolder : "",
        type: typeof record.type === "string" ? record.type : "output",
        nodeId: currentNodeId,
      });
    }
    for (const [key, child] of Object.entries(record)) {
      collectHistoryFiles(child, out, /^\d+$/.test(String(key)) ? String(key) : currentNodeId);
    }
  }
  return out;
}

function scoreHistoryFile(item: HistoryFile, expectedPrefix?: string) {
  let score = 0;
  const name = String(item.filename || "").toLowerCase();
  const subfolder = String(item.subfolder || "").toLowerCase();
  if (item.nodeId === "271") score += 300;
  if (/\.(mp4|webm|mov|mkv)$/i.test(name)) score += 100;
  if (expectedPrefix && name.startsWith(String(expectedPrefix).toLowerCase())) score += 50;
  if (subfolder.includes("scail") || subfolder.includes("editvideo") || subfolder.includes("video")) score += 20;
  return score;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function writeResponseBodyToFile(res: Response, targetPath: string) {
  const tmpPath = `${targetPath}.tmp-${Date.now()}`;
  try {
    if (!res.body) {
      const buffer = Buffer.from(await res.arrayBuffer());
      await fsp.writeFile(tmpPath, buffer);
    } else {
      const nodeStream = Readable.fromWeb(res.body as any);
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(tmpPath);
        nodeStream.on("error", reject);
        out.on("error", reject);
        out.on("finish", resolve);
        nodeStream.pipe(out);
      });
    }
    await fsp.rename(tmpPath, targetPath);
  } catch (error) {
    await fsp.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function uploadLocalFileToComfy(args: { comfyBaseUrl: string; filePath: string; fileName: string; stage: string }) {
  const buffer = await fsp.readFile(args.filePath);
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)]), cleanFileName(args.fileName, path.basename(args.filePath)));
  form.append("overwrite", "true");
  form.append("type", "input");

  const res = await fetchStage(`${args.comfyBaseUrl}/upload/image`, { method: "POST", body: form }, args.stage, 120_000);
  const parsed = await readJsonOrText(res);
  if (!res.ok) {
    throw new StageError(args.stage, `Comfy upload failed (${res.status})`, res.status, parsed.json || parsed.text);
  }

  const json: any = parsed.json || {};
  const name = String(json.name || json.filename || "").trim();
  if (!name) throw new StageError(args.stage, "Comfy upload response did not include a filename.", res.status, parsed.json || parsed.text);
  const subfolder = String(json.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return subfolder ? `${subfolder}/${name}` : name;
}

async function writeUploadFile(file: File, directory: string, fallbackName: string, extensionPattern: RegExp) {
  const fileName = cleanFileName(file.name || fallbackName, fallbackName);
  if (!extensionPattern.test(fileName)) throw new StageError("input", `Unsupported file type: ${fileName}`, 400);
  const target = safeJoin(directory, fileName);
  await fsp.writeFile(target, Buffer.from(await file.arrayBuffer()));
  return { path: target, name: fileName };
}

async function resolveInputVideo(args: {
  form: FormData;
  sources: Awaited<ReturnType<typeof getGallerySourcesForRequest>>["sources"];
  inputDir: string;
}): Promise<InputVideo> {
  const source = String(args.form.get("video_source") || "").trim();
  const title = String(args.form.get("video_title") || "Selected video").trim();

  if (source === "upload") {
    const value = args.form.get("video_file");
    if (!(value instanceof File)) {
      throw new StageError("input", "Missing uploaded video.", 400);
    }
    const saved = await writeUploadFile(value, args.inputDir, "uploaded_video.mp4", VIDEO_EXT_RE);
    return { path: saved.path, label: saved.name, title, source: "upload" };
  }

  if (source === "gallery") {
    const name = String(args.form.get("video_name") || "").trim();
    const scope = String(args.form.get("video_scope") || "").trim();
    const item = resolveGalleryItemByName({ sources: args.sources, name, scopeHint: scope || null });
    if (!item || item.kind !== "video") {
      throw new StageError("input", "Gallery video not found.", 404);
    }
    return { path: item.path, label: item.name || path.basename(item.path), title, source: "gallery" };
  }

  throw new StageError("input", "Choose a source video first.", 400);
}

async function prepareSelectedWorkflowClip(args: {
  inputVideo: InputVideo;
  request: SwapPlanRequest;
  inputDir: string;
}): Promise<InputVideo> {
  const sourceBase = path.parse(args.inputVideo.label).name || "source-video";
  let clip: Awaited<ReturnType<typeof trimH3ReferenceVideoClip>>;
  try {
    clip = await trimH3ReferenceVideoClip({
      inputPath: args.inputVideo.path,
      outputDir: path.join(args.inputDir, "selected-clip"),
      outputPrefix: `${sourceBase}_swap-window`,
      startSeconds: args.request.clipStartSeconds,
      includeAudio: args.request.preserveAudio,
    });
  } catch (error) {
    throw new StageError(
      "prepare_clip",
      error instanceof Error ? error.message : "Could not prepare the selected five-second source clip.",
      400,
    );
  }

  return {
    ...args.inputVideo,
    path: clip.outputPath,
    label: `${sourceBase}_clip_${clip.startSeconds.toFixed(2)}s_${H3_REFERENCE_VIDEO_CLIP_SECONDS}s.mp4`,
    source: `${args.inputVideo.source}-selected-clip`,
    clipStartSeconds: clip.startSeconds,
    clipDurationSeconds: clip.durationSeconds,
    sourceDurationSeconds: clip.sourceDurationSeconds,
  };
}

async function saveReplacementFiles(swaps: SwapMapping[], inputDir: string) {
  return Promise.all(swaps.map(async (swap, index) => {
    if (!swap.replacementFile) {
      throw new StageError("input", `Upload a replacement image for ${swap.replacementLabel}.`, 400);
    }
    const saved = await writeUploadFile(swap.replacementFile, inputDir, `replacement_${index + 1}.png`, IMAGE_EXT_RE);
    return {
      ...swap,
      localPath: saved.path,
      localName: saved.name,
    };
  }));
}

function setNodeInput(graph: Record<string, any>, nodeId: string, inputs: Record<string, unknown>) {
  if (!graph[nodeId] || typeof graph[nodeId] !== "object") return;
  graph[nodeId].inputs = graph[nodeId].inputs && typeof graph[nodeId].inputs === "object" ? graph[nodeId].inputs : {};
  Object.assign(graph[nodeId].inputs, inputs);
}

function scailObjectIndex(selector: string) {
  return scailSourceObjectIndex(selector);
}

function loadScailGraph(params: {
  sourceVideoName: string;
  replacementImageName: string;
  prompt: string;
  outputPrefix: string;
  sourceSelector: string;
}) {
  const workflowPath = path.join(process.cwd(), "comfy_workflows", "internal", "edit-video", "video_wan21_scail2_character_replacement.api.json");
  const graph = JSON.parse(fs.readFileSync(workflowPath, "utf8")) as Record<string, any>;
  delete graph.__otg;

  const objectIndex = scailObjectIndex(params.sourceSelector);
  setNodeInput(graph, "155", { file: params.sourceVideoName });
  setNodeInput(graph, "30", { image: params.replacementImageName });
  setNodeInput(graph, "213:3", { text: params.prompt });
  setNodeInput(graph, "262:258", { text: params.prompt });
  setNodeInput(graph, "213:4", { text: "" });
  setNodeInput(graph, "262:257", { text: "" });
  setNodeInput(graph, "213:197", { object_indices: objectIndex, sort_by: "left_to_right" });
  setNodeInput(graph, "262:245", { object_indices: objectIndex, sort_by: "left_to_right" });
  for (const [sourceMask,referenceTrack,condition,wan] of [["213:197","213:198","213:191","213:114"],["262:245","262:246","262:242","262:259"]]) {
    setNodeInput(graph,condition,{text:params.sourceSelector || "human"});
    const referenceMask=`${sourceMask}:reference`;
    graph[referenceMask]={class_type:"SCAIL2ColoredMask",inputs:{driving_track_data:[referenceTrack,0],ref_track_data:[referenceTrack,0],object_indices:"0",sort_by:"left_to_right",replacement_mode:true}};
    // A source's second/third person still maps to the first person in its
    // separate replacement image. Never reuse the source ordinal on it.
    setNodeInput(graph,wan,{reference_image_mask:[referenceMask,1]});
  }
  setNodeInput(graph, "202", { filename_prefix: `${params.outputPrefix}_segment` });
  setNodeInput(graph, "271", { filename_prefix: params.outputPrefix });

  return graph;
}

async function submitPrompt(comfyBaseUrl: string, graph: Record<string, any>, jobId: string) {
  const clientId = `otg-swap-characters-${crypto.randomUUID()}`;
  const res = await submitComfyPromptWithGpuLease({
    baseUrl: comfyBaseUrl,
    workerId: "edit-video-swap-characters",
    releaseIdlePeer: true,
    ownerId: jobId,
    purpose: "video",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    },
    fetcher: (url, init) => fetchStage(url, init, "submit_prompt", 120_000),
  });
  const parsed = await readJsonOrText(res);
  if (!res.ok) {
    throw new StageError("submit_prompt", String((parsed.json as any)?.error?.message || (parsed.json as any)?.error || parsed.text || `Comfy prompt failed (${res.status})`), res.status, parsed.json || parsed.text);
  }
  const promptId = String((parsed.json as any)?.prompt_id || "").trim();
  if (!promptId) throw new StageError("submit_prompt", "Comfy response did not include prompt_id.", res.status, parsed.json || parsed.text);
  return promptId;
}

async function pollHistory(comfyBaseUrl: string, promptId: string) {
  const deadline = Date.now() + POLL_MAX_MS;
  let lastText = "";
  while (Date.now() < deadline) {
    const res = await fetchStage(`${comfyBaseUrl}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, "poll_history", 60_000);
    const parsed = await readJsonOrText(res);
    lastText = parsed.text;
    if (res.ok && parsed.json) {
      const json: any = parsed.json;
      const record = json[promptId] || json;
      if (record?.status?.status_str === "error") {
        throw new StageError("poll_history", "Comfy workflow failed.", 500, record);
      }
      if (record?.outputs) return record;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new StageError("poll_history", "Timed out waiting for SCAIL-2 character swap result.", 504, lastText.slice(0, 1000));
}

async function copyOrDownloadOutput(args: { comfyBaseUrl: string; file: HistoryFile; targetPath: string }) {
  const localPath = resolveExistingComfyOutputPath(args.file);
  if (localPath) {
    await fsp.copyFile(localPath, args.targetPath);
    return;
  }

  const url = new URL(`${args.comfyBaseUrl}/view`);
  url.searchParams.set("filename", basenameOnly(args.file.filename));
  url.searchParams.set("subfolder", String(args.file.subfolder || ""));
  url.searchParams.set("type", String(args.file.type || "output"));

  const failures: string[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await fetchStage(url.toString(), { method: "GET" }, "download_output", 10 * 60_000);
    if (res.ok) {
      await writeResponseBodyToFile(res, args.targetPath);
      return;
    }
    const text = await res.text().catch(() => "");
    failures.push(`${res.status}: ${text.slice(0, 160)}`);
    await sleep(VIEW_RETRY_MS);
  }

  throw new StageError("download_output", "Could not download generated SCAIL-2 video from ComfyUI.", 502, { file: args.file, failures });
}

async function saveResultToGallery(args: {
  source: GallerySource;
  outputPath: string;
  outputTitle: string;
  jobId: string;
  promptId: string;
  request: SwapPlanRequest;
}) {
  const ext = path.extname(args.outputPath).toLowerCase() || ".mp4";
  const desired = safeGalleryName(`${args.outputTitle || "character_swap_preview"}_scail2_${args.jobId.slice(0, 8)}${ext}`);
  const targetPath = path.join(args.source.dir, desired);
  await fsp.copyFile(args.outputPath, targetPath);
  warmGalleryThumb(targetPath, 768);
  warmGalleryThumb(targetPath, 512);

  const stat = fs.statSync(targetPath);
  const savedName = path.basename(targetPath);
  writeMetaForFile(targetPath, {
    originalName: savedName,
    renamedName: savedName,
    sourceType: "edit-video-swap-characters",
    requestKind: "edit-video-swap-characters",
    mediaCategory: "edited-video",
    positivePrompt: buildSwapPlan(args.request).prompt,
    workflowId: "edit-video/swap-characters/scail2",
    workflowTitle: "Edit Video - Swap Characters - SCAIL-2",
    sourcePromptId: args.promptId,
    submitPayload: {
      requestKind: "edit-video-swap-characters",
      jobId: args.jobId,
      engine: args.request.engine,
      sourceVideoName: args.request.sourceName,
      sourceVideoTitle: args.request.sourceTitle,
      clipStartSeconds: args.request.clipStartSeconds,
      clipDurationSeconds: args.request.clipDurationSeconds,
      swaps: args.request.swaps.map(({ replacementFile: _replacementFile, ...swap }) => swap),
    },
    ownerKey: args.source.ownerKey,
    username: args.source.username,
    deviceId: args.source.deviceId,
    createdAt: stat.birthtimeMs || stat.mtimeMs || Date.now(),
    updatedAt: Date.now(),
  }, args.source);
  clearGalleryListCache();

  return {
    fileName: savedName,
    scope: args.source.scope,
    url: `/api/gallery/file?name=${encodeURIComponent(savedName)}&scope=${args.source.scope}`,
  };
}

async function runScailSubmit(args: {
  request: SwapPlanRequest;
  inputVideo: InputVideo;
  inputDir: string;
  jobDir: string;
  jobId: string;
  gallerySource: GallerySource;
}) {
  if (args.request.swaps.length > 1) {
    throw new StageError("input", "SCAIL-2 test submission currently supports one character mapping per render. Remove extra mappings or use MiniMax H3 for multi-reference testing.", 400);
  }

  const comfyBaseUrl = normalizeBaseUrl(configuredVideoComfyBaseUrl());
  if (!comfyBaseUrl) throw new StageError("config", "No ComfyUI video base URL configured.", 500);

  const replacement = (await saveReplacementFiles(args.request.swaps, args.inputDir))[0];
  const framePlan=scailFramePlan(args.request.clipDurationSeconds);
  const paddedSource=path.join(args.inputDir,"scail-conditioning-24fps.mp4");
  const padded=await runCmd(resolveFfmpegPath(),["-y","-i",args.inputVideo.path,"-an","-vf","fps=24,tpad=stop_mode=clone:stop_duration=0.1","-frames:v",String(framePlan.conditioningFrames),"-c:v","libx264","-crf","18","-pix_fmt","yuv420p",paddedSource],{timeoutMs:120000});
  if(padded.code!==0)throw new StageError("input","Could not prepare frame-aligned SCAIL conditioning.",500);
  const [comfyVideoName, comfyImageName] = await Promise.all([
    uploadLocalFileToComfy({ comfyBaseUrl, filePath: paddedSource, fileName: `scail_${args.jobId}.mp4`, stage: "upload_source_video" }),
    uploadLocalFileToComfy({ comfyBaseUrl, filePath: replacement.localPath, fileName: replacement.localName, stage: "upload_replacement_image" }),
  ]);

  const outputPrefix = `EditVideo/SCAIL2_${safeSegment(args.jobId)}`;
  const graph = loadScailGraph({
    sourceVideoName: comfyVideoName,
    replacementImageName: comfyImageName,
    prompt: buildSwapPlan(args.request).prompt,
    outputPrefix,
    sourceSelector: replacement.sourceSelector || replacement.sourceLabel,
  });
  const promptId = await submitPrompt(comfyBaseUrl, graph, args.jobId);
  const history = await pollHistory(comfyBaseUrl, promptId);
  const files = collectHistoryFiles(history.outputs || history).filter((file) => /\.(mp4|webm|mov|mkv)$/i.test(file.filename || ""));
  if (!files.length) throw new StageError("find_output", "No SCAIL-2 video output was found in ComfyUI history.", 502, history.outputs || history);
  files.sort((a, b) => scoreHistoryFile(b, "SCAIL2") - scoreHistoryFile(a, "SCAIL2"));
  const chosen = files[0];

  const outputName = `${safeSegment(args.request.outputTitle || "character_swap_preview")}_${args.jobId.slice(0, 8)}${path.extname(chosen.filename || ".mp4") || ".mp4"}`;
  const outputPath = safeJoin(args.jobDir, outputName);
  const rawOutputPath=safeJoin(args.jobDir,"scail-raw.mp4");
  await copyOrDownloadOutput({ comfyBaseUrl, file: chosen, targetPath: rawOutputPath });
  const restored=await runCmd(resolveFfmpegPath(),["-y","-i",rawOutputPath,"-i",args.inputVideo.path,"-map","0:v:0",...(args.request.preserveAudio?["-map","1:a:0?","-c:a","aac"]:["-an"]),"-t",String(args.request.clipDurationSeconds),"-c:v","copy","-movflags","+faststart",outputPath],{timeoutMs:120000});
  if(restored.code!==0)throw new StageError("finalize","Could not restore exact source duration and audio.",500);
  const stat = fs.statSync(outputPath);
  const gallery = await saveResultToGallery({
    source: args.gallerySource,
    outputPath,
    outputTitle: args.request.outputTitle,
    jobId: args.jobId,
    promptId,
    request: args.request,
  });

  return {
    status: "completed",
    engine: "scail2",
    backend: "rtx3090",
    jobId: args.jobId,
    promptId,
    fileName: outputName,
    url: `/api/edit-video/file?jobId=${encodeURIComponent(args.jobId)}&name=${encodeURIComponent(outputName)}`,
    galleryUrl: gallery.url,
    galleryFileName: gallery.fileName,
    galleryScope: gallery.scope,
    sizeBytes: stat.size,
  };
}

async function h3ReferenceFromVideo(args: { inputVideo: InputVideo; request: SwapPlanRequest; inputDir: string }): Promise<H3DirectReference> {
  const clipStart = Number(args.inputVideo.clipStartSeconds ?? args.request.clipStartSeconds ?? 0);
  const clipDuration = Number(args.inputVideo.clipDurationSeconds || H3_REFERENCE_VIDEO_CLIP_SECONDS);

  return {
    path: args.inputVideo.path,
    name: args.inputVideo.label,
    description: [
      `${args.inputVideo.title || args.inputVideo.label} is the source video plate for the character swap.`,
      `Use selected ${H3_REFERENCE_VIDEO_CLIP_SECONDS}-second reference window ${clipStart.toFixed(2)}s-${(clipStart + clipDuration).toFixed(2)}s.`,
    ].join(" "),
    includeAudio: args.request.preserveAudio,
  };
}

async function runH3Submit(args: {
  request: SwapPlanRequest;
  inputVideo: InputVideo;
  inputDir: string;
  owner: Awaited<ReturnType<typeof getGallerySourcesForRequest>>["owner"];
}) {
  const replacements = await saveReplacementFiles(args.request.swaps, args.inputDir);
  const video = await h3ReferenceFromVideo({ inputVideo: args.inputVideo, request: args.request, inputDir: args.inputDir });
  const images: H3DirectReference[] = replacements.map((replacement, index) => ({
    path: replacement.localPath,
    name: replacement.localName,
    description: [
      `${replacement.replacementLabel || `Replacement ${index + 1}`} replaces ${replacement.sourceSelector || replacement.sourceLabel}.`,
      replacement.notes,
    ].filter(Boolean).join(" "),
  }));

  const durationSeconds = H3_REFERENCE_VIDEO_CLIP_SECONDS as H3ProductionDuration;
  const sourceShape = await probeVideoInfo(args.inputVideo.path);
  const input = validateH3DirectInput({
    targetBackend: args.request.targetBackend,
    mode: "h3-reference-to-video",
    quality: "lq",
    orientation: (sourceShape.height || 0) > (sourceShape.width || 0) ? "portrait" : "landscape",
    durationSeconds,
    prompt: buildSwapPlan(args.request).prompt,
    seed: crypto.randomBytes(6).readUIntBE(0, 6),
    optionalLoras: [],
    firstImage: null,
    lastImage: null,
    images,
    videos: [video],
    audios: [],
  });
  const job = await createH3DirectJob(args.owner.ownerKey, input, args.owner);
  startH3DirectJob(job);
  return h3DirectPublicStatus(job);
}

export async function POST(req: NextRequest) {
  try {
    try { await requireSessionUser(req); } catch { throw new SessionInvalidError(); }
    const form = await req.formData();
    const built = buildSwapPlanFromForm(form);
    if (!built.ok) return NextResponse.json({ ok: false, error: built.error }, { status: built.status });

    const { owner, sources } = await getGallerySourcesForRequest(req);
    const jobId = `swap-${crypto.randomUUID()}`;
    const jobRoot = editVideoJobRoot(owner.ownerKey);
    const jobDir = safeJoin(jobRoot, jobId);
    const inputDir = safeJoin(jobDir, "input");
    ensureDir(inputDir);

    const inputVideo = await resolveInputVideo({ form, sources, inputDir });
    if (!fs.existsSync(inputVideo.path) || !fs.statSync(inputVideo.path).isFile()) {
      throw new StageError("input", "Source video file does not exist.", 404);
    }
    const selectedClipVideo = await prepareSelectedWorkflowClip({
      inputVideo,
      request: built.request,
      inputDir,
    });

    const selectedShape = await probeVideoInfo(selectedClipVideo.path);
    const planned = buildSwapPlan(built.request, "submitted");
    const submittedPlan = {
      ...planned,
      recipe: {
        ...planned.recipe,
        recommendedSettings: {
          ...(planned.recipe.recommendedSettings as Record<string, unknown>),
          sourceWidth: selectedShape.width,
          sourceHeight: selectedShape.height,
          orientation: (selectedShape.height || 0) > (selectedShape.width || 0) ? "portrait" : "landscape",
          ...(built.request.engine === "scail2" ? {
            frame_count: scailFramePlan(built.request.clipDurationSeconds).outputFrames,
            conditioningFrames: scailFramePlan(built.request.clipDurationSeconds).conditioningFrames,
          } : {}),
        },
      },
      safety: {
        inferenceSubmitted: true,
        note: built.request.engine === "minimax-h3"
          ? "MiniMax H3 reference-to-video job was queued with the selected five-second source clip."
          : "SCAIL-2 character replacement was submitted with the selected five-second source clip.",
      },
    };

    if (built.request.engine === "minimax-h3") {
      const job = await runH3Submit({
        request: built.request,
        inputVideo: selectedClipVideo,
        inputDir,
        owner,
      });
      return NextResponse.json({ ok: true, mode: "submitted", engine: built.request.engine, plan: submittedPlan, job }, { status: 202 });
    }

    const result = await runScailSubmit({
      request: built.request,
      inputVideo: selectedClipVideo,
      inputDir,
      jobDir,
      jobId,
      gallerySource: sources[0],
    });

    return NextResponse.json({ ok: true, mode: "completed", engine: built.request.engine, plan: submittedPlan, result });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof StageError) {
      return NextResponse.json({ ok: false, error: error.message, stage: error.stage, detail: error.detail }, { status: error.status || 500 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Swap Characters submission failed." }, { status: 500 });
  }
}

