import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { loadWorkflowById, extractPromptGraph, validatePromptGraph } from "@/lib/workflows";
import { removeBackgroundBestEffort } from "@/app/api/angles/_lib/backgroundRemoval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type HistoryFile = { filename: string; subfolder?: string; type?: string };

const DEFAULT_ANGLES_IMAGE_COMFY_URL = "http://127.0.0.1:8288";
const ANGLES_IMAGE_WORKFLOW_ID = "internal/angles_multiview_texture_turntable_v12_hotfix";

const LOAD_IMAGE_NODE_ID = "41";
const CAMERA_NODE_ID = "93";
const SAMPLER_NODE_ID = "108";
const DECODE_NODE_ID = "103";
const OUTPUT_NODE_ID = "110";

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(?:$|\?)/i;
const DEFAULT_POLL_MAX_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;

class StageError extends Error {
  stage: string;
  detail?: unknown;
  status?: number;

  constructor(stage: string, message: string, status?: number, detail?: unknown) {
    super(message);
    this.name = "StageError";
    this.stage = stage;
    this.status = status;
    this.detail = detail;
  }
}

function safeDeviceId(raw: string | null) {
  const v = (raw || "").toString().trim();
  const cleaned = v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return cleaned || "local";
}

function ensureDirSync(p: string) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}

function normalizeBase(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function parseBool(value: FormDataEntryValue | null, fallback = false) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseNumber(value: FormDataEntryValue | null, fallback: number) {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function normalizeDegrees(raw: number) {
  if (!Number.isFinite(raw)) return 0;
  return ((Math.round(raw) % 360) + 360) % 360;
}

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function fetchStage(url: string, init: RequestInit, stage: string, timeoutMs: number) {
  const { signal, cancel } = timeoutSignal(timeoutMs);
  try {
    return await fetch(url, { ...init, signal, cache: "no-store" });
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? `Request timed out after ${timeoutMs}ms.` : e?.message || String(e);
    throw new StageError(stage, msg);
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

async function assertComfyReachable(baseUrl: string) {
  const health = await fetchStage(`${baseUrl}/system_stats`, { method: "GET" }, "angles_image_healthcheck", 10_000);
  const parsed = await readJsonOrText(health);
  if (!health.ok) {
    throw new StageError(
      "angles_image_healthcheck",
      `Remote Comfy healthcheck failed (${health.status}).`,
      health.status,
      parsed.json ?? parsed.text
    );
  }
  return parsed.json ?? parsed.text;
}

function extractImageFilesFromHistory(record: any): HistoryFile[] {
  const out: HistoryFile[] = [];
  const seen = new Set<string>();

  const visit = (value: any) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;

    const filename = value.filename ? String(value.filename) : "";
    if (filename && IMAGE_EXT_RE.test(filename)) {
      const hf: HistoryFile = {
        filename,
        subfolder: value.subfolder ? String(value.subfolder) : "",
        type: value.type ? String(value.type) : "output",
      };
      const key = `${hf.type}|${hf.subfolder}|${hf.filename}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(hf);
      }
    }

    for (const nested of Object.values(value)) visit(nested);
  };

  visit(record?.outputs || record);
  return out;
}

function pickBestImageFile(files: HistoryFile[], expectedBase: string) {
  if (!files.length) return null;
  const byPrefix = files.find((f) => f.filename.startsWith(expectedBase));
  if (byPrefix) return byPrefix;
  const outputFile = files.find((f) => (f.type || "output") === "output");
  return outputFile || files[0];
}

async function fetchComfyViewBytes(baseUrl: string, f: HistoryFile) {
  const filename = encodeURIComponent(f.filename);
  const type = encodeURIComponent(f.type || "output");
  const subfolder = encodeURIComponent(f.subfolder || "");
  const url = `${baseUrl}/view?filename=${filename}&type=${type}&subfolder=${subfolder}`;

  const r = await fetchStage(url, { method: "GET" }, "angles_image_fetch_output", 60_000);
  if (!r.ok) {
    const parsed = await readJsonOrText(r);
    throw new StageError(
      "angles_image_fetch_output",
      `Comfy /view failed (${r.status}) for ${f.filename}.`,
      r.status,
      parsed.json ?? parsed.text
    );
  }
  return Buffer.from(await r.arrayBuffer());
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeUploadedName(upJson: any) {
  const name = upJson?.name ? String(upJson.name) : "";
  if (!name) return "";
  const rawSubfolder = upJson?.subfolder ? String(upJson.subfolder) : "";
  const subfolder = rawSubfolder
    .split(String.fromCharCode(92))
    .join("/")
    .split("/")
    .filter(Boolean)
    .join("/");
  return subfolder ? `${subfolder}/${name}` : name;
}

function configureQwenMultiangleWorkflow(
  graph: any,
  opts: {
    uploadedName: string;
    prefix: string;
    horizontal: number;
    vertical: number;
    zoom: number;
    seed: number;
    defaultPrompts: boolean;
    cameraView: boolean;
  }
) {
  const loadImage = graph?.[LOAD_IMAGE_NODE_ID];
  if (loadImage?.class_type !== "LoadImage" || !loadImage.inputs) {
    throw new StageError(
      "angles_image_prepare_workflow",
      `Angles Qwen workflow is missing LoadImage node ${LOAD_IMAGE_NODE_ID}.`,
      500,
      { workflowId: ANGLES_IMAGE_WORKFLOW_ID, nodeId: LOAD_IMAGE_NODE_ID, found: loadImage?.class_type }
    );
  }
  loadImage.inputs.image = opts.uploadedName;

  const camera = graph?.[CAMERA_NODE_ID];
  if (camera?.class_type !== "QwenMultiangleCameraNode" || !camera.inputs) {
    throw new StageError(
      "angles_image_prepare_workflow",
      `Angles Qwen workflow is missing QwenMultiangleCameraNode ${CAMERA_NODE_ID}.`,
      500,
      { workflowId: ANGLES_IMAGE_WORKFLOW_ID, nodeId: CAMERA_NODE_ID, found: camera?.class_type }
    );
  }
  camera.inputs.horizontal_angle = opts.horizontal;
  camera.inputs.vertical_angle = opts.vertical;
  camera.inputs.zoom = opts.zoom;
  camera.inputs.default_prompts = opts.defaultPrompts;
  camera.inputs.camera_view = opts.cameraView;

  const sampler = graph?.[SAMPLER_NODE_ID];
  if (sampler?.inputs) {
    sampler.inputs.seed = opts.seed;
  }

  const output = graph?.[OUTPUT_NODE_ID];
  if (!output || !output.inputs) {
    throw new StageError(
      "angles_image_prepare_workflow",
      `Angles Qwen workflow is missing output node ${OUTPUT_NODE_ID}.`,
      500,
      { workflowId: ANGLES_IMAGE_WORKFLOW_ID }
    );
  }

  // Keep the uploaded workflow's PreviewImage output. ComfyUI returns PreviewImage assets
  // through /history as type=temp files. Replacing PreviewImage with SaveImage can fail
  // validation on some ComfyUI/custom-node setups, even though the preview renders in the UI.
  if (output.class_type === "PreviewImage") {
    output.inputs.images = [DECODE_NODE_ID, 0];
  } else if (output.class_type === "SaveImage") {
    output.inputs.images = [DECODE_NODE_ID, 0];
    output.inputs.filename_prefix = opts.prefix;
  } else {
    throw new StageError(
      "angles_image_prepare_workflow",
      `Angles Qwen workflow output node ${OUTPUT_NODE_ID} must be PreviewImage or SaveImage.`,
      500,
      { workflowId: ANGLES_IMAGE_WORKFLOW_ID, nodeId: OUTPUT_NODE_ID, found: output.class_type }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await getOwnerContext(req);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }

  try {
    const deviceId = safeDeviceId(req.headers.get("x-otg-device-id"));
    const COMFY_BASE_URL = normalizeBase(
      process.env.OTG_ANGLES_IMAGE_COMFY_URL ||
        process.env.OTG_ANGLES_MULTIVIEW_COMFY_URL ||
        DEFAULT_ANGLES_IMAGE_COMFY_URL
    );
    const comfyClientId = `${deviceId}-angles-qwen-image`;
    const pollMaxMs = parsePositiveInt(process.env.OTG_ANGLES_IMAGE_MAX_MS, DEFAULT_POLL_MAX_MS);
    const pollIntervalMs = parsePositiveInt(process.env.OTG_ANGLES_IMAGE_POLL_MS, DEFAULT_POLL_INTERVAL_MS);

    const fd = await req.formData();
    const file = fd.get("image");
    const removeBackground = parseBool(fd.get("removeBackground"));
    const rawHorizontal = parseNumber(fd.get("angleHorizontal"), 0);
    const rawVertical = parseNumber(fd.get("angleVertical"), 0);
    const rawZoom = parseNumber(fd.get("angleZoom"), 5);
    const horizontal = normalizeDegrees(rawHorizontal);
    const vertical = clamp(Math.round(rawVertical), -90, 90);
    const zoom = clamp(Math.round(rawZoom), 1, 10);
    const defaultPrompts = parseBool(fd.get("angleDefaultPrompts"), false);
    const cameraView = parseBool(fd.get("angleCameraView"), false);
    const rawSeed = parseNumber(fd.get("seed"), -1);
    const seed = Number.isFinite(rawSeed) && rawSeed >= 0 ? Math.floor(rawSeed) : Math.floor(Math.random() * 999_999_999_999_999);

    if (!file || typeof file === "string") {
      return NextResponse.json({ ok: false, error: "Missing image file" }, { status: 400 });
    }

    let uploadName = (file as any)?.name ? String((file as any).name) : `otg_angles_${Date.now()}.png`;
    let uploadBytes = Buffer.from(await (file as any).arrayBuffer());
    let preprocessNote = "Using original image.";

    if (removeBackground) {
      const cutout = await removeBackgroundBestEffort(uploadBytes);
      uploadBytes = cutout.buffer;
      uploadName = `${path.basename(uploadName, path.extname(uploadName))}_cutout.png`;
      preprocessNote = cutout.note;
    }

    const healthInfo = await assertComfyReachable(COMFY_BASE_URL);

    const up = new FormData();
    up.append("image", new Blob([new Uint8Array(uploadBytes)], { type: "image/png" }), uploadName);
    up.append("type", "input");
    up.append("overwrite", "true");

    const upRes = await fetchStage(`${COMFY_BASE_URL}/upload/image`, { method: "POST", body: up }, "angles_image_upload", 60_000);
    const upParsed = await readJsonOrText(upRes);
    const upJson: any = upParsed.json;

    if (!upRes.ok || !upJson?.name) {
      throw new StageError(
        "angles_image_upload",
        upJson?.error || `Comfy upload failed (${upRes.status}).`,
        upRes.status,
        upJson ?? upParsed.text
      );
    }

    const uploadedName = normalizeUploadedName(upJson);
    if (!uploadedName) {
      throw new StageError("angles_image_upload", "Comfy upload succeeded but did not return a filename.", 500, upJson);
    }

    const wf = loadWorkflowById(ANGLES_IMAGE_WORKFLOW_ID);
    if (!wf.ok) {
      return NextResponse.json(
        { ok: false, error: `Workflow not found: ${ANGLES_IMAGE_WORKFLOW_ID}`, detail: wf.error },
        { status: wf.status }
      );
    }

    const extracted = extractPromptGraph(wf.json);
    if (!extracted.ok) return NextResponse.json({ ok: false, error: extracted.error }, { status: 400 });

    const validated = validatePromptGraph(extracted.graph);
    if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });

    const graph: any = JSON.parse(JSON.stringify(extracted.graph));
    const prefix = `otg_tmp_angles/${deviceId}/qwen_multiangle_${Date.now()}`;
    const expectedBase = path.posix.basename(prefix);

    configureQwenMultiangleWorkflow(graph, {
      uploadedName,
      prefix,
      horizontal,
      vertical,
      zoom,
      seed,
      defaultPrompts,
      cameraView,
    });

    const submit = await fetchStage(
      `${COMFY_BASE_URL}/prompt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: graph, client_id: comfyClientId }),
      },
      "angles_image_submit_prompt",
      30_000
    );

    const submitParsed = await readJsonOrText(submit);
    const submitJson: any = submitParsed.json;

    if (!submit.ok || !submitJson?.prompt_id) {
      throw new StageError(
        "angles_image_submit_prompt",
        submitJson?.error || `Comfy submit failed (${submit.status}).`,
        submit.status,
        submitJson ?? submitParsed.text
      );
    }

    const promptId = String(submitJson.prompt_id);
    const start = Date.now();
    let imageFile: HistoryFile | null = null;
    let historyFiles: HistoryFile[] = [];
    let lastHistorySummary: any = null;

    while (Date.now() - start < pollMaxMs) {
      const histRes = await fetchStage(
        `${COMFY_BASE_URL}/history/${encodeURIComponent(promptId)}`,
        { method: "GET" },
        "angles_image_poll_history",
        20_000
      );
      const histParsed = await readJsonOrText(histRes);
      const histJson: any = histParsed.json;

      if (!histRes.ok) {
        throw new StageError(
          "angles_image_poll_history",
          `Comfy history failed (${histRes.status}).`,
          histRes.status,
          histJson ?? histParsed.text
        );
      }

      const record = histJson?.[promptId] ?? histJson;
      historyFiles = extractImageFilesFromHistory(record);
      imageFile = pickBestImageFile(historyFiles, expectedBase);
      lastHistorySummary = {
        status: record?.status ?? null,
        nodeIds: Object.keys(record?.outputs || {}),
        files: historyFiles,
      };

      if (imageFile) break;

      const completed =
        record?.status?.completed === true ||
        record?.status?.status_str === "success" ||
        record?.status?.status_str === "completed";

      if (completed && !imageFile) break;
      await sleep(pollIntervalMs);
    }

    if (!imageFile) {
      throw new StageError(
        "angles_image_poll_history",
        "Angles image workflow finished, but no retrievable image file appeared in ComfyUI history.",
        504,
        {
          promptId,
          endpoint: COMFY_BASE_URL,
          expectedPrefix: prefix,
          outputNodeId: OUTPUT_NODE_ID,
          note: "The route keeps PreviewImage node 110 and retrieves the resulting temp image from ComfyUI history. If this still fails, inspect ComfyUI history outputs for node 110.",
          lastHistorySummary,
        }
      );
    }

    const bytes = await fetchComfyViewBytes(COMFY_BASE_URL, imageFile);
    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const outputDir = path.join(dataRoot, "tmp", "angles_created", deviceId);
    ensureDirSync(outputDir);

    const safeLocalName = path.basename(imageFile.filename);
    const localPath = path.join(outputDir, safeLocalName);
    await fs.writeFile(localPath, bytes);

    // OTG_ANGLES_LATEST_IMAGE_URL_FIX_V2:
    // Always return a unique URL and the reusable local path so Angles and Production Change Angle
    // cannot keep showing the first browser-cached preview after later generations.
    const previewToken = Date.now() + "_" + Math.random().toString(36).slice(2, 10);
    const imageUrl = `/api/file?path=${encodeURIComponent(localPath)}&v=${previewToken}`;

    const resultImage = {
      label: "Camera Angle",
      url: imageUrl,
      imageUrl,
      imagePath: localPath,
      serverPath: localPath,
      localPath,
      filename: safeLocalName,
      remoteFile: imageFile,
      angleHorizontal: horizontal,
      angleVertical: vertical,
      zoom,
    };

    return NextResponse.json(
      {
        ok: true,
        promptId,
        endpoint: COMFY_BASE_URL,
        workflowId: ANGLES_IMAGE_WORKFLOW_ID,
        preprocess: preprocessNote,
        system: healthInfo,
        remoteFile: imageFile,
        imageUrl,
        imageExt: path.extname(imageFile.filename) || ".png",
        images: [resultImage],
        outputs: [resultImage],
        selectedAngle: "Qwen Multiangle Camera",
        requestedCamera: {
          horizontal,
          vertical,
          zoom,
          defaultPrompts,
          cameraView,
          seed,
          note: "QwenMultiangleCameraNode consumes horizontal_angle, vertical_angle, zoom, default_prompts, and camera_view.",
        },
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    if (e instanceof StageError) {
      return NextResponse.json(
        { ok: false, error: e.message, stage: e.stage, status: e.status ?? 500, detail: e.detail ?? null },
        { status: e.status && e.status >= 400 ? e.status : 500 }
      );
    }

    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
