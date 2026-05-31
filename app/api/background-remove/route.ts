import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { assertAllowedWorkerTargetUrl } from "@/lib/runtime/workerTargetPolicy";

import { NextRequest, NextResponse } from "next/server";

import { configuredImageComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir, OTG_DATA_ROOT, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type HistoryFile = {
  filename: string;
  subfolder?: string;
  type?: string;
  nodeId?: string;
};

type InputImage = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  sourcePath?: string;
};

const WORKFLOW_ID = "utility/birefnet-remove-background";
const WORKFLOW_PATH = path.join(process.cwd(), "comfy_workflows", "internal", "utility_birefnet_remove_background.json");

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|bmp)$/i;
const POLL_MAX_MS = Math.max(60_000, Number(process.env.OTG_BG_REMOVE_MAX_MS || 10 * 60 * 1000));
const POLL_INTERVAL_MS = Math.max(750, Number(process.env.OTG_BG_REMOVE_POLL_MS || 1500));
const VIEW_MAX_ATTEMPTS = Math.max(3, Number(process.env.OTG_BG_REMOVE_VIEW_MAX_ATTEMPTS || 12));
const VIEW_RETRY_MS = Math.max(500, Number(process.env.OTG_BG_REMOVE_VIEW_RETRY_MS || 1000));

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(raw: string) {
  return String(raw || "").trim().replace(/\/+$/, "");
}

function safeFileName(raw: string, fallback = "background_remove_input.png") {
  const parsed = path.parse(String(raw || fallback));
  const ext = IMAGE_EXT_RE.test(parsed.ext) ? parsed.ext.toLowerCase() : ".png";
  const stem =
    (parsed.name || fallback)
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 90) || "background_remove_input";

  return `${stem}${ext}`;
}

function cleanOutputStem(raw: string) {
  return (
    String(raw || "background_removed")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 90) || "background_removed"
  );
}

function contentTypeFor(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();

  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";

  return "application/octet-stream";
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

async function readJsonBody(req: NextRequest) {
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}

async function readInputImage(req: NextRequest): Promise<InputImage> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") || form.get("image") || form.get("input");

    if (!(file instanceof File) || file.size <= 0) {
      throw new StageError("read_input", "Missing image file.");
    }

    return {
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: safeFileName(file.name || "background_remove_input.png"),
      mimeType: file.type || contentTypeFor(file.name || "background_remove_input.png"),
    };
  }

  const body = await readJsonBody(req);
  const imagePath = String(body.imagePath || body.path || "").trim();

  if (!imagePath) {
    throw new StageError("read_input", "Provide multipart file/image or JSON imagePath.");
  }

  const abs = path.resolve(imagePath);

  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new StageError("read_input", `Input image not found: ${abs}`);
  }

  return {
    buffer: await fsp.readFile(abs),
    fileName: safeFileName(path.basename(abs)),
    mimeType: contentTypeFor(abs),
    sourcePath: abs,
  };
}

async function uploadImageToComfy(args: { comfyBaseUrl: string; input: InputImage }) {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(args.input.buffer)], { type: args.input.mimeType }), args.input.fileName);
  form.append("overwrite", "true");
  form.append("type", "input");

  const res = await fetchStage(`${args.comfyBaseUrl}/upload/image`, { method: "POST", body: form }, "upload_image", 60_000);
  const parsed = await readJsonOrText(res);

  if (!res.ok) {
    throw new StageError("upload_image", `ComfyUI upload failed (${res.status}).`, res.status, parsed.json || parsed.text);
  }

  const json: any = parsed.json || {};
  const name = String(json.name || json.filename || args.input.fileName);
  const subfolder = String(json.subfolder || "")
    .split(String.fromCharCode(92))
    .join("/")
    .split("/")
    .filter(Boolean)
    .join("/");

  return subfolder ? `${subfolder}/${name}` : name;
}

function loadWorkflowGraph(uploadedImageName: string) {
  if (!fs.existsSync(WORKFLOW_PATH)) {
    throw new StageError("load_workflow", `Missing workflow file: ${WORKFLOW_PATH}`);
  }

  const graph: any = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));

  if (!graph["17"] || graph["17"].class_type !== "LoadImage") {
    throw new StageError("load_workflow", "BiRefNet workflow missing LoadImage node 17.");
  }

  if (!graph["19:14"] || graph["19:14"].class_type !== "LoadBackgroundRemovalModel") {
    throw new StageError("load_workflow", "BiRefNet workflow missing LoadBackgroundRemovalModel node 19:14.");
  }

  if (!graph["19:13"] || graph["19:13"].class_type !== "RemoveBackground") {
    throw new StageError("load_workflow", "BiRefNet workflow missing RemoveBackground node 19:13.");
  }

  if (!graph["19:16"] || graph["19:16"].class_type !== "JoinImageWithAlpha") {
    throw new StageError("load_workflow", "BiRefNet workflow missing JoinImageWithAlpha node 19:16.");
  }

  graph["17"].inputs.image = uploadedImageName;
  graph["19:14"].inputs.bg_removal_name = "birefnet.safetensors";

  return graph;
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
      const nextNodeId = /^\d+(?::\d+)?$/.test(String(key)) ? String(key) : currentNodeId;
      collectHistoryFiles(child, out, nextNodeId);
    }
  }

  return out;
}

function scoreHistoryImage(file: HistoryFile) {
  const name = String(file.filename || "").toLowerCase();
  let score = 0;

  if (IMAGE_EXT_RE.test(name)) score += 20;
  if (file.nodeId === "18") score += 100;
  if (String(file.type || "").toLowerCase() === "temp") score += 10;
  if (name.includes("preview")) score += 5;

  return score;
}

function pickOutputImage(historyJson: any, promptId: string) {
  const promptBlock = historyJson?.[promptId] ?? historyJson;
  const all = collectHistoryFiles(promptBlock, []).filter((item) => IMAGE_EXT_RE.test(item.filename));

  if (!all.length) return null;

  return all.slice().sort((a, b) => scoreHistoryImage(b) - scoreHistoryImage(a))[0] || null;
}

async function submitPrompt(args: { comfyBaseUrl: string; graph: any }) {
  const clientId = `otg_bg_remove_${Date.now()}_${randomUUID()}`;
  const res = await fetchStage(
    `${args.comfyBaseUrl}/prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: args.graph, client_id: clientId }),
    },
    "submit_prompt",
    60_000,
  );

  const parsed = await readJsonOrText(res);

  if (!res.ok || !parsed.json?.prompt_id) {
    throw new StageError(
      "submit_prompt",
      parsed.json?.error || `ComfyUI did not return a prompt_id (${res.status}).`,
      res.status,
      parsed.json || parsed.text,
    );
  }

  return String(parsed.json.prompt_id);
}

async function pollHistoryForImage(comfyBaseUrl: string, promptId: string) {
  const started = Date.now();
  let lastPayload: any = null;

  while (Date.now() - started < POLL_MAX_MS) {
    const res = await fetchStage(`${comfyBaseUrl}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, "poll_history", 25_000);
    const parsed = await readJsonOrText(res);

    if (res.ok && parsed.json) {
      lastPayload = parsed.json;
      const hit = pickOutputImage(parsed.json, promptId);
      if (hit) return { file: hit, historyPayload: parsed.json };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new StageError("poll_history", `Timed out waiting for BiRefNet background removal output for prompt ${promptId}.`, 504, lastPayload);
}

async function fetchViewBinary(baseUrl: string, file: HistoryFile) {
  const params = new URLSearchParams();
  params.set("filename", file.filename);
  params.set("type", file.type || "output");
  if (file.subfolder) params.set("subfolder", file.subfolder);

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

  throw new StageError(
    "fetch_view",
    `Failed to fetch BiRefNet output after ${VIEW_MAX_ATTEMPTS} attempts.`,
    lastStatus,
    lastDetail?.json ?? lastDetail?.text,
  );
}

function outputDirForOwner(ownerKey: string) {
  const ownerSafe = safeSegment(ownerKey || "local");
  const dir = path.join(OTG_DATA_ROOT, "background_removal", ownerSafe);
  ensureDir(dir);
  return dir;
}

async function saveBackgroundRemovedImage(args: {
  ownerKey: string;
  sourceName: string;
  bytes: Buffer;
}) {
  const dir = outputDirForOwner(args.ownerKey);
  const stem = cleanOutputStem(args.sourceName);
  const outName = `${Date.now()}_${stem}_birefnet.png`;
  const outPath = path.join(dir, outName);

  await fsp.writeFile(outPath, args.bytes);

  return outPath;
}

// GLOBAL_BIREFNET_BACKGROUND_REMOVAL_ROUTE

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const input = await readInputImage(req);
    const comfyBaseUrl = normalizeBaseUrl(assertAllowedWorkerTargetUrl(configuredImageComfyBaseUrl() || "http://127.0.0.1:8188", "background-remove ComfyUI worker target"));

    const comfyImageName = await uploadImageToComfy({ comfyBaseUrl, input });
    const graph = loadWorkflowGraph(comfyImageName);
    const promptId = await submitPrompt({ comfyBaseUrl, graph });
    const historyHit = await pollHistoryForImage(comfyBaseUrl, promptId);
    const outputBytes = await fetchViewBinary(comfyBaseUrl, historyHit.file);
    const outputPath = await saveBackgroundRemovedImage({
      ownerKey: owner.ownerKey,
      sourceName: input.fileName,
      bytes: outputBytes,
    });

    const stat = fs.statSync(outputPath);
    const fileName = path.basename(outputPath);

    return NextResponse.json(
      {
        ok: true,
        workflowId: WORKFLOW_ID,
        model: "birefnet.safetensors",
        promptId,
        fileName,
        path: outputPath,
        imagePath: outputPath,
        url: `/api/file?path=${encodeURIComponent(outputPath)}`,
        sourcePath: input.sourcePath || null,
        remoteFile: historyHit.file,
        sizeBytes: stat.size,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const stage = error instanceof StageError ? error.stage : "background_remove";
    const status = error instanceof StageError && error.status ? error.status : 500;
    const detail = error instanceof StageError ? error.detail : undefined;

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Background removal failed.",
        stage,
        detail,
      },
      { status },
    );
  }
}