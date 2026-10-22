
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { cancelComfyPrompt, ComfyCancelSafetyError } from "@/lib/comfySafeCancel";
import { assertH3LtxAlphaAvailable } from "@/lib/h3SpecialModes/ltxAlphaMotion";
import { buildLtxStudiosAlpha } from "@/lib/ltxStudiosAlpha";
import {buildLtxStudioWorkflow,inspectLtxStudioRuntime,isLtxStudioRuntimeTool,LTX_STUDIO_RUNTIME,type LtxStudioRuntimeTool} from "@/lib/ltxStudiosRuntime";
import { probeVideoInfo } from "@/lib/videoFrame";

import { configuredVideoComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getGallerySourcesForRequest, resolveGalleryItemByName } from "@/lib/gallery";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { submitComfyPromptWith5060Lease } from "@/lib/workers/comfyPromptLease";
import { freshProductionSeed } from "@/lib/production/randomSeed";
import {
  ensureComfyClientProgressMonitor,
  readComfyPromptProgress,
  recordComfyPromptSubmitted,
  waitForComfyClientProgressMonitor,
} from "@/lib/comfyProgress";

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

type LtxEditLiveJobMeta = {
  jobId: string;
  ownerKey: string;
  promptId: string;
  comfyClientId: string;
  comfyBaseUrl: string;
  outputBase: string;
  inputVideoTitle: string;
  task: string;
  instruction: string;
  durationSeconds: number;
  fps: number;
  longerSide: number;
  useVideoReasoning: boolean;
  obscuraStrength?: number;
  studioTool?: LtxStudioRuntimeTool;
  speed?: number;
  seed?: number;
  createdAt: string;
  status: "running" | "completed" | "canceling" | "canceled" | "failed";
  result?: Record<string, unknown>;
  error?: string;
};

const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|avi)$/i;
const POLL_MAX_MS = Math.max(60_000, Number(process.env.OTG_EDIT_VIDEO_LTX_EDIT_MAX_MS || 20 * 60 * 1000));
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.OTG_EDIT_VIDEO_LTX_EDIT_POLL_MS || 1500));
const VIEW_RETRY_MS = Math.max(750, Number(process.env.OTG_EDIT_VIDEO_LTX_EDIT_VIEW_RETRY_MS || 1250));

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

function comfyFailureDetail(record: any) {
  const status = record?.status || {};
  const nodeErrors = status?.messages || record?.node_errors || status?.node_errors;
  const executionError=Array.isArray(status?.messages)?status.messages.find((entry:any)=>entry?.[0]==="execution_error")?.[1]:null;
  const nodeMessage=executionError?.exception_message?`Node ${executionError.node_id}: ${String(executionError.exception_message).split("\n")[0]}`:null;
  const message = nodeMessage || status?.message || record?.error?.message || status?.status_str;
  let safeNodeErrors: unknown = undefined;
  if (nodeErrors) {
    try {
      safeNodeErrors = JSON.parse(JSON.stringify(nodeErrors).slice(0, 6000));
    } catch {
      safeNodeErrors = "Comfy returned node error details that could not be serialized.";
    }
  }
  return {
    message: String(message || "Comfy workflow failed.").slice(0, 800),
    nodeErrors: safeNodeErrors,
  };
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
  const withoutExt = path.basename(String(value || "ltx_edit_anything"), path.extname(String(value || "")) || undefined);
  const clean = withoutExt.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_").replace(/\s+/g, " ").trim();
  return (clean || "ltx_edit_anything").slice(0, 90);
}

function editVideoJobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "edit_video_jobs", safeSegment(ownerKey || "local"));
}

function liveJobMetaPath(jobDir: string) {
  return safeJoin(jobDir, "ltx-edit-job.json");
}

async function writeLiveJobMeta(jobDir: string, meta: LtxEditLiveJobMeta) {
  await fsp.writeFile(liveJobMetaPath(jobDir), JSON.stringify(meta, null, 2), "utf8");
}

async function readLiveJobMeta(ownerKey: string, jobId: string) {
  const jobRoot = editVideoJobRoot(ownerKey);
  const jobDir = safeJoin(jobRoot, jobId);
  const metaPath = liveJobMetaPath(jobDir);
  const text = await fsp.readFile(metaPath, "utf8");
  const meta = JSON.parse(text) as LtxEditLiveJobMeta;
  if (meta.ownerKey !== ownerKey || meta.jobId !== jobId) {
    throw new StageError("job_lookup", "LTX edit job was not found for this session.", 404);
  }
  return { jobDir, meta };
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
  const subfolder = String(item.subfolder || "").toLowerCase();
  if (item.nodeId === "146") score += 200;
  if (/\.(mp4|webm|mov|mkv)$/i.test(name)) score += 100;
  if (expectedPrefix && name.startsWith(String(expectedPrefix).toLowerCase())) score += 50;
  if (subfolder.includes("editvideo") || subfolder.includes("ltx") || subfolder.includes("edit")) score += 20;
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

async function uploadLocalFileToComfy(args: { comfyBaseUrl: string; filePath: string; fileName: string }) {
  const buffer = await fsp.readFile(args.filePath);
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)]), cleanFileName(args.fileName, "source_video.mp4"));
  form.append("overwrite", "true");
  form.append("type", "input");

  const res = await fetchStage(`${args.comfyBaseUrl}/upload/image`, { method: "POST", body: form }, "upload_source_video", 120_000);
  const parsed = await readJsonOrText(res);
  if (!res.ok) {
    throw new StageError("upload_source_video", `Comfy upload failed (${res.status})`, res.status, parsed.json || parsed.text);
  }

  const json: any = parsed.json || {};
  const name = String(json.name || json.filename || "").trim();
  if (!name) throw new StageError("upload_source_video", "Comfy upload response did not include a filename.", res.status, parsed.json || parsed.text);
  const subfolder = String(json.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return subfolder ? `${subfolder}/${name}` : name;
}

async function resolveInputVideo(args: {
  form: FormData;
  sources: Awaited<ReturnType<typeof getGallerySourcesForRequest>>["sources"];
  inputDir: string;
  image?: boolean;
}): Promise<InputVideo> {
  const source = firstText(args.form.get("video_source"));
  const title = firstText(args.form.get("video_title")) || "Selected video";

  if (source === "upload") {
    const value = args.form.get("video_file");
    if (!(value instanceof File)) {
      throw new StageError("input", args.image?"Missing uploaded image.":"Missing uploaded video.", 400);
    }
    const inputName = cleanFileName(value.name || "uploaded_video.mp4", "uploaded_video.mp4");
    if (!(args.image ? /\.(png|jpe?g|webp)$/i : VIDEO_EXT_RE).test(inputName)) throw new StageError("input", args.image ? "Use a PNG, JPEG, or WEBP source image." : "Unsupported video file type.", 400);
    const inputPath = safeJoin(args.inputDir, inputName);
    const buffer = Buffer.from(await value.arrayBuffer());
    await fsp.writeFile(inputPath, buffer);
    return { path: inputPath, label: inputName, title, source: "upload" };
  }

  if (source === "gallery") {
    const name = firstText(args.form.get("video_name"));
    const scope = firstText(args.form.get("video_scope"));
    const item = resolveGalleryItemByName({ sources: args.sources, name, scopeHint: scope || null });
    if (!item || item.kind !== (args.image ? "image" : "video")) {
      throw new StageError("input", "Gallery source media not found.", 404);
    }
    return { path: item.path, label: item.name || path.basename(item.path), title, source: "gallery" };
  }

  throw new StageError("input", "Choose a source video first.", 400);
}

function setNodeInput(graph: any, nodeId: string, inputs: Record<string, any>) {
  if (!graph[nodeId] || typeof graph[nodeId] !== "object") return;
  graph[nodeId].inputs = graph[nodeId].inputs && typeof graph[nodeId].inputs === "object" ? graph[nodeId].inputs : {};
  Object.assign(graph[nodeId].inputs, inputs);
}

function compileInstruction(task: string, instruction: string) {
  const raw = instruction.trim();
  if (!raw) return raw;
  if (task === "obscura_remova") return `remove obstruction: ${raw}`;
  const normalizedTask = String(task || "add").replace(/_/g, " ").trim();
  if (/^(add|remove|replace|convert style|style)\s*[:\-]/i.test(raw)) return raw;
  return `${normalizedTask}: ${raw}`;
}

function nextNumericNodeId(graph: Record<string, unknown>) {
  return String(
    Math.max(
      0,
      ...Object.keys(graph)
        .map((key) => Number(key))
        .filter((value) => Number.isFinite(value)),
    ) + 1,
  );
}

function findFirstNodeByClass(graph: Record<string, any>, classType: string) {
  return Object.entries(graph).find(([, node]) => String(node?.class_type || "") === classType) || null;
}

function insertModelOnlyLora(graph: Record<string, any>, args: { loraName: string; strength: number; beforeModelConsumerClass?: string }) {
  const consumerEntry = args.beforeModelConsumerClass ? findFirstNodeByClass(graph, args.beforeModelConsumerClass) : null;
  const consumer = consumerEntry?.[1];
  const modelInput = consumer?.inputs?.model;
  if (!Array.isArray(modelInput) || !modelInput[0]) return false;

  const loraId = nextNumericNodeId(graph);
  graph[loraId] = {
    class_type: "LoraLoaderModelOnly",
    inputs: {
      lora_name: args.loraName,
      strength_model: args.strength,
      model: modelInput,
    },
  };
  consumer.inputs.model = [loraId, 0];
  return true;
}

function applyOptionalLtxLoras(graph: Record<string, any>, args: { task: string; useVideoReasoning: boolean; obscuraStrength: number }) {
  if (args.task === "obscura_remova") {
    insertModelOnlyLora(graph, {
      loraName: process.env.OTG_OBSCURA_REMOVA_LORA || "LTX23_Obscura_Remova_v1.safetensors",
      strength: Math.max(0, Math.min(3, Number(args.obscuraStrength) || 2.3)),
      beforeModelConsumerClass: "BasicScheduler",
    });
  }

  if (args.useVideoReasoning) {
    insertModelOnlyLora(graph, {
      loraName: process.env.OTG_LTX_VIDEO_REASONING_LORA || "Ltx2.3-Licon-VBVR-I2V-390K-R32.safetensors",
      strength: Math.max(0, Math.min(2, Number(process.env.OTG_LTX_VIDEO_REASONING_STRENGTH || 1) || 1)),
      beforeModelConsumerClass: "BasicScheduler",
    });
  }
}

function buildGraph(params: {
  sourceVideoName: string;
  task: string;
  instruction: string;
  negativePrompt: string;
  durationSeconds: number;
  fps: number;
  longerSide: number;
  seed: number;
  outputPrefix: string;
  useVideoReasoning: boolean;
  obscuraStrength: number;
}) {
  const workflowPath = path.join(process.cwd(), "comfy_workflows", "internal", "edit-video", "ltx23_edit_anything.json");
  const raw = fs.readFileSync(workflowPath, "utf8");
  const graph = JSON.parse(raw);
  delete graph.__otg;

  const seed = Number.isFinite(params.seed) && params.seed >= 0 ? Math.floor(params.seed) : Math.floor(Math.random() * 9007199254740991);

  setNodeInput(graph, "128", { video: params.sourceVideoName, force_rate: params.fps });
  setNodeInput(graph, "140", { text: compileInstruction(params.task, params.instruction) });
  setNodeInput(graph, "68", { text: params.negativePrompt || "" });
  setNodeInput(graph, "78", { value: params.durationSeconds });
  setNodeInput(graph, "79", { value: params.fps });
  setNodeInput(graph, "139", { value: params.longerSide });
  setNodeInput(graph, "77", { noise_seed: seed });
  setNodeInput(graph, "146", { filename_prefix: params.outputPrefix });
  applyOptionalLtxLoras(graph, {
    task: params.task,
    useVideoReasoning: params.useVideoReasoning,
    obscuraStrength: params.obscuraStrength,
  });

  return graph;
}

async function submitPrompt(args: {
  comfyBaseUrl: string;
  graph: any;
  ownerKey: string;
  deviceId: string;
}) {
  const clientId = `otg-ltx-edit-${randomUUID()}`;
  ensureComfyClientProgressMonitor({ comfyBaseUrl: args.comfyBaseUrl, clientId });
  await waitForComfyClientProgressMonitor({ comfyBaseUrl: args.comfyBaseUrl, clientId, timeoutMs: 1500 });
  const res = await submitComfyPromptWith5060Lease({
    baseUrl: args.comfyBaseUrl,
    workerId: "edit-video-ltx-edit",
    releaseIdlePeer: true,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: args.graph, client_id: clientId }),
    },
    fetcher: (url, init) => fetchStage(url, init, "submit_prompt", 120_000),
  });
  const parsed = await readJsonOrText(res);
  if (!res.ok) {
    throw new StageError("submit_prompt", String((parsed.json as any)?.error?.message || (parsed.json as any)?.error || parsed.text || `Comfy prompt failed (${res.status})`), res.status, parsed.json || parsed.text);
  }
  const promptId = String((parsed.json as any)?.prompt_id || "").trim();
  if (!promptId) throw new StageError("submit_prompt", "Comfy response did not include prompt_id.", res.status, parsed.json || parsed.text);
  recordComfyPromptSubmitted({
    promptId,
    ownerKey: args.ownerKey,
    deviceId: args.deviceId,
    clientId,
    comfyBaseUrl: args.comfyBaseUrl,
    totalNodes: args.graph && typeof args.graph === "object" ? Object.keys(args.graph).length : null,
  });
  ensureComfyClientProgressMonitor({ comfyBaseUrl: args.comfyBaseUrl, clientId });
  return { promptId, clientId };
}

async function readHistoryOnce(comfyBaseUrl: string, promptId: string) {
  const res = await fetchStage(`${comfyBaseUrl}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, "poll_history", 30_000);
  const parsed = await readJsonOrText(res);
  if (!res.ok || !parsed.json) return null;
  const json: any = parsed.json;
  const record = json[promptId] || json;
  if (record?.status?.status_str === "error") {
    const detail = comfyFailureDetail(record);
    throw new StageError("poll_history", `Comfy workflow failed: ${detail.message}`, 500, detail);
  }
  return record?.outputs ? record : null;
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
      if (record?.outputs) return record;
      if (record?.status?.status_str === "error") {
        const detail = comfyFailureDetail(record);
        throw new StageError("poll_history", `Comfy workflow failed: ${detail.message}`, 500, detail);
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new StageError("poll_history", "Timed out waiting for LTX Edit Anything result.", 504, lastText.slice(0, 1000));
}

const COMFY_OUTPUT_DOWNLOAD_TIMEOUT_MS = Math.max(120_000, Number(process.env.OTG_COMFY_OUTPUT_DOWNLOAD_TIMEOUT_MS || 10 * 60 * 1000));

// OTG_COMFY_OUTPUT_DOWNLOAD_STREAM: stream ComfyUI /view downloads to disk instead of buffering large videos.
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
    try { await fsp.rm(tmpPath, { force: true }); } catch {}
    throw error;
  }
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
    const res = await fetchStage(url.toString(), { method: "GET" }, "download_output", COMFY_OUTPUT_DOWNLOAD_TIMEOUT_MS);
    if (res.ok) {
      await writeResponseBodyToFile(res, args.targetPath);
      return;
    }
    const text = await res.text().catch(() => "");
    failures.push(`${res.status}: ${text.slice(0, 160)}`);
    await sleep(VIEW_RETRY_MS);
  }

  throw new StageError("download_output", "Could not download generated LTX edited video from ComfyUI.", 502, { file: args.file, failures });
}

async function finalizeLiveJobIfReady(jobDir: string, meta: LtxEditLiveJobMeta) {
  if(meta.status==="failed")throw new StageError("execution",meta.error||"This workflow failed. Correct the input and submit again.",500);
  if(meta.status === "canceling") {
    const canceled=await cancelComfyPrompt(meta.comfyBaseUrl,meta.promptId);
    if(canceled.status!=="completed") {
      await writeLiveJobMeta(jobDir,{...meta,status:canceled.status});
      return {ok:true,status:canceled.status,running:canceled.status==="canceling",jobId:meta.jobId,promptId:meta.promptId};
    }
  }
  if (meta.status === "completed" && meta.result) {
    return {
      ok: true,
      status: "complete",
      running: false,
      ...meta.result,
    };
  }

  if (meta.status === "canceled") {
    return {
      ok: true,
      status: "canceled",
      running: false,
      jobId: meta.jobId,
      promptId: meta.promptId,
    };
  }

  let history;
  try{history=await readHistoryOnce(meta.comfyBaseUrl, meta.promptId);}catch(error){
    if(error instanceof StageError&&error.message.startsWith("Comfy workflow failed:"))await writeLiveJobMeta(jobDir,{...meta,status:"failed",error:error.message});
    throw error;
  }
  const progress = readComfyPromptProgress(meta.promptId);
  if (!history?.outputs) {
    return {
      ok: true,
      status: "running",
      running: true,
      jobId: meta.jobId,
      promptId: meta.promptId,
      progressPercent: progress?.percent ?? 0,
      approximatePreview: progress?.approximatePreview || null,
    };
  }

  const files = collectHistoryFiles(history.outputs || history).filter((file) => /\.(mp4|webm|mov|mkv)$/i.test(file.filename || ""));
  if (!files.length) throw new StageError("find_output", "No video output was found in ComfyUI history.", 502, history.outputs || history);
  files.sort((a, b) => scoreHistoryFile(b, "LTX_Edit") - scoreHistoryFile(a, "LTX_Edit"));
  const chosen = meta.studioTool==="sdr-to-hdr" ? files.find(file=>!file.filename.endsWith("_hlg.mp4")) : files[0];
  if(!chosen)throw new StageError("find_output","SDR preview output is missing.",502);

  const outputName = `${meta.outputBase}_${meta.jobId.slice(0, 8)}${path.extname(chosen.filename || ".mp4") || ".mp4"}`;
  const outputPath = safeJoin(jobDir, outputName);
  await copyOrDownloadOutput({ comfyBaseUrl: meta.comfyBaseUrl, file: chosen, targetPath: outputPath });

  const stat = fs.statSync(outputPath);
  const outputInfo = await probeVideoInfo(outputPath);
  let hdrMasterUrl:string|undefined,exrArchiveUrl:string|undefined;
  if(meta.studioTool==="sdr-to-hdr"){
    const allFiles=collectHistoryFiles(history.outputs||history);
    for(const [suffix,localName] of [["_hlg.mp4","hdr_master.mp4"],["_acescg_exr.zip","acescg_exr.zip"]]){
      const file=allFiles.find(item=>item.filename.endsWith(suffix));
      if(!file)throw new StageError("find_output",`HDR deliverable missing: ${suffix}`,502);
      await copyOrDownloadOutput({comfyBaseUrl:meta.comfyBaseUrl,file,targetPath:safeJoin(jobDir,localName)});
      const url=`/api/edit-video/file?jobId=${encodeURIComponent(meta.jobId)}&name=${encodeURIComponent(localName)}&download=1`;
      if(localName==="hdr_master.mp4")hdrMasterUrl=url;else exrArchiveUrl=url;
    }
  }
  const result = {
    jobId: meta.jobId,
    promptId: meta.promptId,
    fileName: outputName,
    url: `/api/edit-video/file?jobId=${encodeURIComponent(meta.jobId)}&name=${encodeURIComponent(outputName)}`,
    sourceVideoName: meta.inputVideoTitle,
    task: meta.task,
    instruction: meta.instruction,
    durationSeconds: outputInfo.durationSeconds ?? meta.durationSeconds,
    fps: outputInfo.fps ?? meta.fps,
    longerSide: meta.longerSide,
    useVideoReasoning: meta.useVideoReasoning,
    obscuraStrength: meta.obscuraStrength,
    studioTool: meta.studioTool,
    speed: meta.speed,
    seed: meta.seed,
    sizeBytes: stat.size,
    hdrMasterUrl,exrArchiveUrl,
  };

  await writeLiveJobMeta(jobDir, {
    ...meta,
    status: "completed",
    result,
  });

  return {
    ok: true,
    status: "complete",
    running: false,
    ...result,
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req).catch(()=>{throw new SessionInvalidError();});
    const { owner } = await getGallerySourcesForRequest(req);
    const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    if (!jobId) throw new StageError("job_lookup", "Missing jobId.", 400);
    const { jobDir, meta } = await readLiveJobMeta(owner.ownerKey, jobId);
    const result = await finalizeLiveJobIfReady(jobDir, meta);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof StageError) {
      return NextResponse.json({ ok: false, error: error.message, stage: error.stage, detail: error.detail }, { status: error.status || 500 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "LTX Edit Anything status failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireSessionUser(req).catch(()=>{throw new SessionInvalidError();});
    const { owner } = await getGallerySourcesForRequest(req);
    const body = await req.json().catch(() => ({}));
    const jobId = String(body?.jobId || req.nextUrl.searchParams.get("jobId") || "").trim();
    if (!jobId) throw new StageError("job_lookup", "Missing jobId.", 400);
    const { jobDir, meta } = await readLiveJobMeta(owner.ownerKey, jobId);

    if(meta.status==="completed"||meta.status==="canceled") return NextResponse.json(await finalizeLiveJobIfReady(jobDir,meta));
    await writeLiveJobMeta(jobDir,{...meta,status:"canceling"});
    try {
      const canceled=await cancelComfyPrompt(meta.comfyBaseUrl,meta.promptId);
      if(canceled.status==="completed")return NextResponse.json(await finalizeLiveJobIfReady(jobDir,{...meta,status:"running"}));
      await writeLiveJobMeta(jobDir,{...meta,status:canceled.status});
      return NextResponse.json({ok:true,...canceled,jobId,promptId:meta.promptId});
    } catch(error) {await writeLiveJobMeta(jobDir,meta);throw error;}
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof ComfyCancelSafetyError) return NextResponse.json({ok:false,error:error.message},{status:409});
    if (error instanceof StageError) {
      return NextResponse.json({ ok: false, error: error.message, stage: error.stage, detail: error.detail }, { status: error.status || 500 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "LTX Edit Anything cancel failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireSessionUser(req).catch(()=>{throw new SessionInvalidError();});
    const form = await req.formData();
    const { owner, sources } = await getGallerySourcesForRequest(req);
    const comfyBaseUrl = normalizeBaseUrl(configuredVideoComfyBaseUrl());
    if (!comfyBaseUrl) throw new StageError("config", "No ComfyUI video base URL configured.", 500);

    const jobId = randomUUID();
    const jobRoot = editVideoJobRoot(owner.ownerKey);
    const jobDir = safeJoin(jobRoot, jobId);
    const inputDir = safeJoin(jobDir, "input");
    ensureDir(inputDir);

    const rawStudioTool = firstText(form.get("studioTool"));
    if (rawStudioTool && !isLtxStudioRuntimeTool(rawStudioTool)) throw new StageError("input", "Unknown LTX Studios tool.", 400);
    const studioTool = rawStudioTool as LtxStudioRuntimeTool | "";
    const inputVideo = await resolveInputVideo({ form, sources, inputDir, image:studioTool ? LTX_STUDIO_RUNTIME[studioTool].image : false });
    if (!fs.existsSync(inputVideo.path) || !fs.statSync(inputVideo.path).isFile()) {
      throw new StageError("input", "Source video file does not exist.", 404);
    }

    const task = firstText(form.get("task")) || "add";
    const instruction = studioTool === "alpha-gen" ? "Generate the foreground alpha matte." : studioTool==="sdr-to-hdr"?"Reference-driven SDR to HDR conversion.":firstText(form.get("instruction"));
    if (!instruction) throw new StageError("input", "Edit instruction is required.", 400);
    const negativePrompt = firstText(form.get("negativePrompt"));
    const durationSeconds = clamp(Number(firstText(form.get("durationSeconds"))) || 5, 1, 30);
    const fps = clamp(Number(firstText(form.get("fps"))) || 24, 8, 60);
    if(studioTool&&durationSeconds*fps>145)throw new StageError("input","LTX Studios supports at most 145 frames. Choose a shorter duration.",400);
    const longerSide = clamp(Number(firstText(form.get("longerSide"))) || 1024, 512, 1536);
    const seed = freshProductionSeed();
    const useVideoReasoning = !studioTool && /^(true|1|yes|on)$/i.test(firstText(form.get("useVideoReasoning")));
    const livePreview = /^(true|1|yes|on)$/i.test(firstText(form.get("livePreview")));
    const obscuraStrength = Number(firstText(form.get("obscuraStrength")) || 2.3);
    const outputBase = cleanOutputBase(firstText(form.get("outputTitle")) || "ltx_edit_anything");
    const outputPrefix = `EditVideo/LTX_Edit_${jobId}`;

    const speed = Number(firstText(form.get("speed")) || 0.2);
    if(studioTool==="slow-motion-control"&&(!Number.isFinite(speed)||speed<0.025||speed>1||fps!==24))throw new StageError("input","Slow Motion Control requires speed 0.025–1 and 24fps playback.",400);
    const comfyVideoName = await uploadLocalFileToComfy({ comfyBaseUrl, filePath: inputVideo.path, fileName: `ltx_${jobId}_${inputVideo.label}` });
    let graph = buildGraph({ sourceVideoName: comfyVideoName, task, instruction, negativePrompt, durationSeconds, fps, longerSide, seed, outputPrefix, useVideoReasoning, obscuraStrength });
    if (studioTool) {
      const compatibility=await inspectLtxStudioRuntime(comfyBaseUrl,studioTool);
      if(!compatibility.compatible)throw new StageError("preflight",`Required LTX model or nodes unavailable: ${[...compatibility.missingNodes,...compatibility.missingAssets].join(", ")}`,503);
      const shape=await probeVideoInfo(inputVideo.path);
      const boundedDuration=LTX_STUDIO_RUNTIME[studioTool].image?durationSeconds:Math.min(durationSeconds,shape.durationSeconds||durationSeconds);
      let lookFilename:string|undefined;
      if(studioTool==="layout-to-render"){
        const look=form.get("look_file");
        if(!(look instanceof File)||!(/\.(png|jpe?g|webp)$/i.test(look.name)))throw new StageError("input","Choose a PNG, JPEG or WEBP finished look image.",400);
        const lookPath=safeJoin(inputDir,"look_"+cleanFileName(look.name,"look.png"));
        await fsp.writeFile(lookPath,Buffer.from(await look.arrayBuffer()));
        const lookShape=await probeVideoInfo(lookPath);if(!lookShape.width||!lookShape.height)throw new StageError("input","Look image could not be decoded.",400);
        lookFilename=await uploadLocalFileToComfy({comfyBaseUrl,filePath:lookPath,fileName:`ltx_look_${jobId}_${path.basename(lookPath)}`});
      }
      graph = buildLtxStudioWorkflow({ tool:studioTool,mediaFilename: comfyVideoName, sourceWidth:shape.width||0,sourceHeight:shape.height||0,longerSide,durationSeconds:boundedDuration,fps,seed,outputPrefix,instruction,negativePrompt,speed,sourceHasAudio:shape.hasAudio,lookFilename }).graph as typeof graph;
    }
    const deviceId = String(req.headers.get("x-otg-device-id") || "edit-video").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96) || "edit-video";
    const submitted = await submitPrompt({ comfyBaseUrl, graph, ownerKey: owner.ownerKey, deviceId });
    const promptId = submitted.promptId;

    if (livePreview || studioTool) {
      await writeLiveJobMeta(jobDir, {
        jobId,
        ownerKey: owner.ownerKey,
        promptId,
        comfyClientId: submitted.clientId,
        comfyBaseUrl,
        outputBase,
        inputVideoTitle: inputVideo.title || inputVideo.label,
        task,
        instruction,
        studioTool: studioTool || undefined,
        speed: studioTool === "slow-motion-control" ? speed : undefined,
        seed,
        durationSeconds,
        fps,
        longerSide,
        useVideoReasoning,
        obscuraStrength: task === "obscura_remova" ? obscuraStrength : undefined,
        createdAt: new Date().toISOString(),
        status: "running",
      });

      return NextResponse.json({
        ok: true,
        status: "running",
        running: true,
        jobId,
        promptId,
        comfyClientId: submitted.clientId,
        progressUrl: `/api/progress?promptId=${encodeURIComponent(promptId)}`,
      }, { status: 202 });
    }

    const history = await pollHistory(comfyBaseUrl, promptId);

    const files = collectHistoryFiles(history.outputs || history).filter((file) => /\.(mp4|webm|mov|mkv)$/i.test(file.filename || ""));
    if (!files.length) throw new StageError("find_output", "No video output was found in ComfyUI history.", 502, history.outputs || history);
    files.sort((a, b) => scoreHistoryFile(b, "LTX_Edit") - scoreHistoryFile(a, "LTX_Edit"));
    const chosen = files[0];

    const outputName = `${outputBase}_${jobId.slice(0, 8)}${path.extname(chosen.filename || ".mp4") || ".mp4"}`;
    const outputPath = safeJoin(jobDir, outputName);
    await copyOrDownloadOutput({ comfyBaseUrl, file: chosen, targetPath: outputPath });

    const stat = fs.statSync(outputPath);
    const outputInfo = await probeVideoInfo(outputPath);
    return NextResponse.json({
      ok: true,
      jobId,
      promptId,
      fileName: outputName,
      url: `/api/edit-video/file?jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(outputName)}`,
      sourceVideoName: inputVideo.title || inputVideo.label,
      task,
      instruction,
      durationSeconds: outputInfo.durationSeconds ?? durationSeconds,
      fps: outputInfo.fps ?? fps,
      longerSide,
      useVideoReasoning,
      obscuraStrength: task === "obscura_remova" ? obscuraStrength : undefined,
      sizeBytes: stat.size,
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof StageError) {
      return NextResponse.json({ ok: false, error: error.message, stage: error.stage, detail: error.detail }, { status: error.status || 500 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "LTX Edit Anything failed" }, { status: 500 });
  }
}
