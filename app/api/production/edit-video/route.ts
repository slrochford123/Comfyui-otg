import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_ROOT = process.cwd();

const COMFY_BASE_URL = String(
  process.env.OTG_LTX_EDIT_COMFY_URL ||
  process.env.OTG_COMFY_URL ||
  process.env.COMFY_URL ||
  "http://127.0.0.1:8188"
).replace(/\/+$/, "");

const COMFY_INPUT_DIR =
  process.env.OTG_COMFY_INPUT_DIR ||
  process.env.COMFYUI_INPUT_DIR ||
  "C:\\AI\\ComfyUI\\ComfyUI\\input";

const GALLERY_PROFILE =
  process.env.OTG_GALLERY_PROFILE ||
  "test_profile";

const GALLERY_DIR =
  process.env.OTG_GALLERY_DIR ||
  path.join(REPO_ROOT, "data", "user_galleries", GALLERY_PROFILE);

const WORKFLOW_PATH =
  process.env.OTG_LTX_EDIT_VIDEO_WORKFLOW ||
  path.join(REPO_ROOT, "app", "workflows", "production", "ltx-edit-anything-video-api.json");

const DEFAULT_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.OTG_LTX_EDIT_VIDEO_TIMEOUT_MS || 90 * 60 * 1000)
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeName(value: unknown, fallback = "file") {
  const raw = String(value || fallback).trim();
  const base = path.basename(raw).replace(/[^\w.\-]+/g, "_");
  return base || fallback;
}

function fileNameFromUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw, "http://local");
    return safeName(
      parsed.searchParams.get("name") ||
      parsed.searchParams.get("filename") ||
      parsed.searchParams.get("file") ||
      path.basename(parsed.pathname),
      ""
    );
  } catch {
    return safeName(raw, "");
  }
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSourceVideo(body: any) {
  const sourcePath = String(body.sourcePath || body.path || "").trim();
  const sourceUrl = String(body.sourceUrl || "").trim();
  const sourceFileName = safeName(
    body.sourceFileName ||
    body.fileName ||
    fileNameFromUrl(sourceUrl),
    ""
  );

  const candidates: string[] = [];

  if (sourcePath && path.isAbsolute(sourcePath)) {
    candidates.push(sourcePath);
  }

  if (sourceFileName) {
    candidates.push(path.join(GALLERY_DIR, sourceFileName));
    candidates.push(path.join(REPO_ROOT, "data", "user_galleries", "test_profile", sourceFileName));
    candidates.push(path.join(REPO_ROOT, "data", "user_galleries", "default", sourceFileName));
    candidates.push(path.join(COMFY_INPUT_DIR, sourceFileName));
  }

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }

  throw new Error(
    `Could not locate source video "${sourceFileName}". Checked gallery and Comfy input folders.`
  );
}

function patchPrompt(prompt: any, args: {
  inputVideoName: string;
  editPrompt: string;
  durationSeconds: number;
  fps: number;
  resolution: number;
  outputPrefix: string;
}) {
  if (!prompt?.["207"]?.inputs) throw new Error("Workflow missing node 207 VHS_LoadVideo.");
  if (!prompt?.["184"]?.inputs) throw new Error("Workflow missing node 184 prompt text node.");

  prompt["207"].inputs.video = args.inputVideoName;
  prompt["207"].inputs.custom_width = 0;
  prompt["207"].inputs.custom_height = 0;
  prompt["207"].inputs.skip_first_frames = 0;
  prompt["207"].inputs.select_every_nth = 1;

  prompt["184"].inputs.string_b = args.editPrompt;

  if (prompt["78"]?.inputs) prompt["78"].inputs.value = args.durationSeconds;
  if (prompt["79"]?.inputs) prompt["79"].inputs.value = args.fps;
  if (prompt["139"]?.inputs) prompt["139"].inputs.value = args.resolution;

  if (prompt["85"]?.inputs) prompt["85"].inputs.duration = args.durationSeconds;
  if (prompt["87"]?.inputs) prompt["87"].inputs.duration = args.durationSeconds;

  if (prompt["77"]?.inputs) {
    prompt["77"].inputs.noise_seed = Math.floor(Math.random() * 2147483647);
  }

  if (prompt["152"]?.inputs) {
    prompt["152"].inputs.save_output = false;
    prompt["152"].inputs.filename_prefix = `${args.outputPrefix}_comparison`;
  }

  if (prompt["198"]?.inputs) {
    prompt["198"].inputs.save_output = true;
    prompt["198"].inputs.filename_prefix = `${args.outputPrefix}_pass1`;
  }

  if (prompt["206"]?.inputs) {
    prompt["206"].inputs.save_output = true;
    prompt["206"].inputs.filename_prefix = args.outputPrefix;
  }

  return prompt;
}

async function queueComfyPrompt(prompt: any) {
  const response = await fetch(`${COMFY_BASE_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      prompt,
      client_id: `otg-ltx-edit-video-${crypto.randomUUID()}`,
    }),
  });

  const text = await response.text();
  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok || !json?.prompt_id) {
    throw new Error(json?.error || json?.message || text || `ComfyUI prompt failed (${response.status}).`);
  }

  return String(json.prompt_id);
}

async function getHistory(promptId: string) {
  const response = await fetch(`${COMFY_BASE_URL}/history/${encodeURIComponent(promptId)}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function collectFiles(value: any, out: any[] = []) {
  if (!value) return out;

  if (Array.isArray(value)) {
    for (const item of value) collectFiles(item, out);
    return out;
  }

  if (typeof value === "object") {
    if (value.filename) out.push(value);
    for (const child of Object.values(value)) collectFiles(child, out);
  }

  return out;
}

async function waitForVideo(promptId: string) {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let lastHistory: any = null;

  while (Date.now() < deadline) {
    const history = await getHistory(promptId);
    lastHistory = history;

    const record = history?.[promptId] || history;

    if (record?.status?.status_str === "error") {
      throw new Error(`ComfyUI workflow failed: ${JSON.stringify(record.status)}`);
    }

    const outputs = record?.outputs;
    if (outputs) {
      const files: any[] = [];

      for (const nodeId of ["206", "198", "152"]) {
        if (outputs[nodeId]) collectFiles(outputs[nodeId], files);
      }

      collectFiles(outputs, files);

      const video = files.find((file) => {
        const name = String(file.filename || "").toLowerCase();
        const format = String(file.format || "").toLowerCase();
        return name.endsWith(".mp4") || name.endsWith(".mov") || name.endsWith(".webm") || format.includes("video");
      });

      if (video?.filename) return video;
    }

    await sleep(2500);
  }

  throw new Error(`Timed out waiting for Edit Video output. Last history: ${JSON.stringify(lastHistory)?.slice(0, 2000)}`);
}

async function fetchComfyViewBytes(file: any) {
  const params = new URLSearchParams({
    filename: String(file.filename || ""),
    subfolder: String(file.subfolder || ""),
    type: String(file.type || "output"),
  });

  const response = await fetch(`${COMFY_BASE_URL}/view?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Comfy /view failed (${response.status}) for ${file.filename}: ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function saveToGallery(bytes: Buffer, fileName: string, meta: any) {
  await fs.mkdir(GALLERY_DIR, { recursive: true });

  const galleryName = safeName(fileName.endsWith(".mp4") ? fileName : `${fileName}.mp4`);
  const galleryPath = path.join(GALLERY_DIR, galleryName);

  await fs.writeFile(galleryPath, bytes);
  await fs.writeFile(`${galleryPath}.meta.json`, JSON.stringify(meta, null, 2), "utf8");

  return {
    fileName: galleryName,
    path: galleryPath,
    url: `/api/gallery/file?name=${encodeURIComponent(galleryName)}&v=${Date.now()}`,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const editPrompt = String(body.prompt || body.visualEditPrompt || "").trim();
    if (!editPrompt) {
      return NextResponse.json({ ok: false, error: "Missing edit prompt." }, { status: 400 });
    }

    const durationSeconds = Math.max(1, Math.min(16, Number(body.durationSeconds || body.durationSec || 8) || 8));
    const fps = Math.max(1, Math.min(24, Number(body.fps || 24) || 24));
    const resolution = Math.max(256, Math.min(1024, Number(body.resolution || 512) || 512));

    const sourceVideoPath = await findSourceVideo(body);

    await fs.mkdir(COMFY_INPUT_DIR, { recursive: true });

    const ext = path.extname(sourceVideoPath) || ".mp4";
    const inputVideoName = safeName(`otg_ltx_edit_input_${Date.now()}${ext}`);
    await fs.copyFile(sourceVideoPath, path.join(COMFY_INPUT_DIR, inputVideoName));

    const workflowRaw = await fs.readFile(WORKFLOW_PATH, "utf8");
    const prompt = JSON.parse(workflowRaw.replace(/^\uFEFF/, ""));

    const outputPrefix = safeName(`otg_ltx_edit_${Date.now()}`).replace(/\.[^.]+$/, "");

    patchPrompt(prompt, {
      inputVideoName,
      editPrompt,
      durationSeconds,
      fps,
      resolution,
      outputPrefix,
    });

    const promptId = await queueComfyPrompt(prompt);
    const outputFile = await waitForVideo(promptId);
    const bytes = await fetchComfyViewBytes(outputFile);

    const gallery = await saveToGallery(bytes, `${outputPrefix}.mp4`, {
      type: "production_edit_video",
      source: "ltx_2_3_edit_anything",
      prompt: editPrompt,
      promptId,
      durationSeconds,
      fps,
      resolution,
      inputVideoName,
      comfyOutput: outputFile,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      promptId,
      editedUrl: gallery.url,
      editedFileName: gallery.fileName,
      galleryUrl: gallery.url,
      fileName: gallery.fileName,
      durationSeconds,
      comfyOutput: outputFile,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Edit Video render failed.",
        endpoint: COMFY_BASE_URL,
        workflowPath: WORKFLOW_PATH,
      },
      { status: 500 }
    );
  }
}