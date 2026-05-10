
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { configuredVideoComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getGallerySourcesForRequest, resolveGalleryItemByName } from "@/lib/gallery";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
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
}): Promise<InputVideo> {
  const source = firstText(args.form.get("video_source"));
  const title = firstText(args.form.get("video_title")) || "Selected video";

  if (source === "upload") {
    const value = args.form.get("video_file");
    if (!(value instanceof File)) {
      throw new StageError("input", "Missing uploaded video.", 400);
    }
    const inputName = cleanFileName(value.name || "uploaded_video.mp4", "uploaded_video.mp4");
    if (!VIDEO_EXT_RE.test(inputName)) throw new StageError("input", "Unsupported video file type.", 400);
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
      throw new StageError("input", "Gallery video not found.", 404);
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

async function submitPrompt(comfyBaseUrl: string, graph: any) {
  const clientId = `otg-ltx-edit-${randomUUID()}`;
  const res = await fetchStage(
    `${comfyBaseUrl}/prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    },
    "submit_prompt",
    120_000,
  );
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
      if (record?.outputs) return record;
      if (record?.status?.status_str === "error") {
        throw new StageError("poll_history", "Comfy workflow failed.", 500, record);
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
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const { owner, sources } = await getGallerySourcesForRequest(req);
    const comfyBaseUrl = normalizeBaseUrl(configuredVideoComfyBaseUrl());
    if (!comfyBaseUrl) throw new StageError("config", "No ComfyUI video base URL configured.", 500);

    const jobId = randomUUID();
    const jobRoot = editVideoJobRoot(owner.ownerKey);
    const jobDir = safeJoin(jobRoot, jobId);
    const inputDir = safeJoin(jobDir, "input");
    ensureDir(inputDir);

    const inputVideo = await resolveInputVideo({ form, sources, inputDir });
    if (!fs.existsSync(inputVideo.path) || !fs.statSync(inputVideo.path).isFile()) {
      throw new StageError("input", "Source video file does not exist.", 404);
    }

    const task = firstText(form.get("task")) || "add";
    const instruction = firstText(form.get("instruction"));
    if (!instruction) throw new StageError("input", "Edit instruction is required.", 400);
    const negativePrompt = firstText(form.get("negativePrompt"));
    const durationSeconds = clamp(Number(firstText(form.get("durationSeconds"))) || 5, 1, 30);
    const fps = clamp(Number(firstText(form.get("fps"))) || 24, 8, 60);
    const longerSide = clamp(Number(firstText(form.get("longerSide"))) || 1024, 512, 1536);
    const seed = Number(firstText(form.get("seed")) || -1);
    const useVideoReasoning = /^(true|1|yes|on)$/i.test(firstText(form.get("useVideoReasoning")));
    const obscuraStrength = Number(firstText(form.get("obscuraStrength")) || 2.3);
    const outputBase = cleanOutputBase(firstText(form.get("outputTitle")) || "ltx_edit_anything");
    const outputPrefix = `EditVideo/LTX_Edit_${jobId}`;

    const comfyVideoName = await uploadLocalFileToComfy({ comfyBaseUrl, filePath: inputVideo.path, fileName: inputVideo.label });
    const graph = buildGraph({ sourceVideoName: comfyVideoName, task, instruction, negativePrompt, durationSeconds, fps, longerSide, seed, outputPrefix, useVideoReasoning, obscuraStrength });
    const promptId = await submitPrompt(comfyBaseUrl, graph);
    const history = await pollHistory(comfyBaseUrl, promptId);

    const files = collectHistoryFiles(history.outputs || history).filter((file) => /\.(mp4|webm|mov|mkv)$/i.test(file.filename || ""));
    if (!files.length) throw new StageError("find_output", "No video output was found in ComfyUI history.", 502, history.outputs || history);
    files.sort((a, b) => scoreHistoryFile(b, "LTX_Edit") - scoreHistoryFile(a, "LTX_Edit"));
    const chosen = files[0];

    const outputName = `${outputBase}_${jobId.slice(0, 8)}${path.extname(chosen.filename || ".mp4") || ".mp4"}`;
    const outputPath = safeJoin(jobDir, outputName);
    await copyOrDownloadOutput({ comfyBaseUrl, file: chosen, targetPath: outputPath });

    const stat = fs.statSync(outputPath);
    return NextResponse.json({
      ok: true,
      jobId,
      promptId,
      fileName: outputName,
      url: `/api/edit-video/file?jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(outputName)}`,
      sourceVideoName: inputVideo.title || inputVideo.label,
      task,
      instruction,
      durationSeconds,
      fps,
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
