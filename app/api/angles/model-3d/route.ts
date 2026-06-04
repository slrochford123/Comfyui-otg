import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_ROOT = path.resolve(process.env.OTG_DATA_DIR || path.join(process.cwd(), "data"));
const TMP_ROOT = path.join(DATA_ROOT, "tmp", "angles_models");
const COMFY_URL = (process.env.OTG_ANGLES_3D_MODEL_COMFY_URL || process.env.OTG_CHARACTER_PREVIEW_COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
const WORKFLOW_PATH = process.env.OTG_ANGLES_3D_MODEL_WORKFLOW || path.join(process.cwd(), "comfy_workflows", "presets", "3D Model.json");
const DEFAULT_TIMEOUT_MS = Number(process.env.OTG_ANGLES_3D_MODEL_TIMEOUT_MS || 1000 * 60 * 60);

type SavedJob = {
  jobId: string;
  createdAt: string;
  deviceId: string;
  sourceImagePath: string;
  sourceImageName: string;
  sourceMimeType: string;
  sourceSize: number;
  modelPath?: string;
  modelExt?: string;
  comfyPromptId?: string;
  comfyOutput?: unknown;
};

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitizeName(name: string) {
  return String(name || "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "item";
}

function writeJob(deviceId: string, job: SavedJob) {
  const jobsDir = path.join(TMP_ROOT, deviceId, "jobs");
  ensureDir(jobsDir);
  fs.writeFileSync(path.join(jobsDir, `${job.jobId}.json`), JSON.stringify(job, null, 2), "utf8");
}

async function readUploadedSource(formData: FormData) {
  const candidateKeys = ["file", "image", "sourceImage", "input", "upload"];

  for (const key of candidateKeys) {
    const entry = formData.get(key);

    if (entry instanceof File) {
      const arrayBuffer = await entry.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return {
        fileName: entry.name || "upload.png",
        mimeType: entry.type || "application/octet-stream",
        size: buffer.byteLength,
        buffer,
        sourceField: key,
      };
    }
  }

  return null;
}

function fileExtFromMime(mimeType: string, fallbackName: string) {
  const existing = path.extname(fallbackName);
  if (existing) return existing.toLowerCase();
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".bin";
}

async function uploadImageToComfy(imagePath: string, originalName: string, mimeType: string) {
  const bytes = fs.readFileSync(imagePath);
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: mimeType || "application/octet-stream" }), originalName || path.basename(imagePath));
  form.append("type", "input");
  form.append("overwrite", "true");

  const resp = await fetch(`${COMFY_URL}/upload/image`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });

  const text = await resp.text();
  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!resp.ok) {
    throw new Error(`ComfyUI image upload failed (${resp.status}): ${text}`);
  }

  const name = String(json?.name || "").trim();
  if (!name) {
    throw new Error(`ComfyUI image upload did not return a name: ${text}`);
  }

  return name;
}

function readWorkflow() {
  if (!fs.existsSync(WORKFLOW_PATH)) {
    throw new Error(`3D Model workflow not found: ${WORKFLOW_PATH}`);
  }

  const raw = fs.readFileSync(WORKFLOW_PATH, "utf8").replace(/^\uFEFF/, "");

  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`3D Model workflow JSON parse failed: ${message}. Path: ${WORKFLOW_PATH}`);
  }
}

function patchWorkflow(workflow: any, uploadedImageName: string, jobId: string) {
  if (!workflow?.["99"]?.inputs) {
    throw new Error("3D Model workflow missing LoadImage node 99.");
  }

  workflow["99"].inputs.image = uploadedImageName;

  if (workflow?.["51"]?.inputs) {
    workflow["51"].inputs.filename_prefix = `3d/OTG_3D_Model_${jobId}`;
  }

  return workflow;
}

async function queuePrompt(workflow: any) {
  const resp = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      prompt: workflow,
      client_id: `otg-angles-3d-model-${crypto.randomUUID()}`,
    }),
  });

  const text = await resp.text();
  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!resp.ok) {
    throw new Error(`ComfyUI prompt failed (${resp.status}): ${text}`);
  }

  const promptId = String(json?.prompt_id || "").trim();
  if (!promptId) {
    throw new Error(`ComfyUI did not return prompt_id: ${text}`);
  }

  return promptId;
}

async function getJson(url: string) {
  const resp = await fetch(url, { cache: "no-store" });
  const text = await resp.text();

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!resp.ok) {
    throw new Error(`ComfyUI request failed (${resp.status}): ${text}`);
  }

  return json;
}

async function waitForHistory(promptId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const history = await getJson(`${COMFY_URL}/history/${encodeURIComponent(promptId)}`);
    if (history?.[promptId]) return history[promptId];
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  throw new Error(`Timed out waiting for ComfyUI 3D Model prompt: ${promptId}`);
}

function collectModelOutputs(value: unknown, out: any[] = []) {
  if (!value) return out;

  if (Array.isArray(value)) {
    for (const item of value) collectModelOutputs(item, out);
    return out;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const filename = String(obj.filename || obj.name || "").trim();

    if (filename && /\.(glb|gltf|spz|ply)$/i.test(filename)) {
      out.push(obj);
    }

    for (const child of Object.values(obj)) {
      collectModelOutputs(child, out);
    }
  }

  return out;
}

function pickModelOutput(history: any) {
  const outputs = history?.outputs || {};
  const all = collectModelOutputs(outputs);

  const preferred =
    all.find((item) => String(item.filename || item.name || "").toLowerCase().endsWith(".glb")) ||
    all.find((item) => String(item.filename || item.name || "").toLowerCase().endsWith(".gltf")) ||
    all.find((item) => String(item.filename || item.name || "").toLowerCase().endsWith(".spz")) ||
    all[0];

  if (!preferred) {
    throw new Error("ComfyUI 3D Model history did not contain a GLB/GLTF/SPZ/PLY output.");
  }

  return preferred;
}

async function downloadComfyOutput(fileInfo: any, targetPath: string) {
  const filename = String(fileInfo.filename || fileInfo.name || "").trim();
  const subfolder = String(fileInfo.subfolder || "").trim();
  const type = String(fileInfo.type || "output").trim() || "output";

  if (!filename) {
    throw new Error(`ComfyUI output is missing filename: ${JSON.stringify(fileInfo)}`);
  }

  const params = new URLSearchParams({ filename, subfolder, type });
  const resp = await fetch(`${COMFY_URL}/view?${params.toString()}`, { cache: "no-store" });

  if (!resp.ok) {
    throw new Error(`Failed to download ComfyUI model output (${resp.status}): ${await resp.text()}`);
  }

  const bytes = Buffer.from(await resp.arrayBuffer());
  if (!bytes.length) {
    throw new Error("Downloaded ComfyUI model output is empty.");
  }

  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, bytes);
}

function modelContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".glb") return "model/gltf-binary";
  if (ext === ".gltf") return "model/gltf+json";
  if (ext === ".spz") return "model/vnd.spz";
  if (ext === ".ply") return "application/octet-stream";
  return "application/octet-stream";
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const uploaded = await readUploadedSource(formData);

    if (!uploaded) {
      return NextResponse.json(
        { ok: false, error: "Missing file upload", expectedFields: ["file", "image", "sourceImage", "input", "upload"] },
        { status: 400 }
      );
    }

    const deviceIdHeader = req.headers.get("x-otg-device-id") || "";
    const deviceIdForm = String(formData.get("deviceId") || formData.get("device_id") || formData.get("userId") || "").trim();
    const deviceId = sanitizeName(deviceIdHeader || deviceIdForm || "default-device");
    const jobId = crypto.randomUUID();
    const deviceDir = path.join(TMP_ROOT, deviceId, jobId);
    ensureDir(deviceDir);

    const sourceExt = fileExtFromMime(uploaded.mimeType, uploaded.fileName);
    const sourceImagePath = path.join(deviceDir, `input${sourceExt}`);
    fs.writeFileSync(sourceImagePath, uploaded.buffer);

    const pendingJob: SavedJob = {
      jobId,
      createdAt: new Date().toISOString(),
      deviceId,
      sourceImagePath,
      sourceImageName: uploaded.fileName,
      sourceMimeType: uploaded.mimeType,
      sourceSize: uploaded.size,
    };
    writeJob(deviceId, pendingJob);

    const uploadedImageName = await uploadImageToComfy(sourceImagePath, uploaded.fileName, uploaded.mimeType);
    const workflow = patchWorkflow(readWorkflow(), uploadedImageName, jobId);
    const patchedWorkflowPath = path.join(deviceDir, "3d-model-patched-workflow.json");
    fs.writeFileSync(patchedWorkflowPath, JSON.stringify(workflow, null, 2), "utf8");

    const promptId = await queuePrompt(workflow);
    const history = await waitForHistory(promptId, DEFAULT_TIMEOUT_MS);
    const historyPath = path.join(deviceDir, "3d-model-history.json");
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf8");

    const output = pickModelOutput(history);
    const outputName = String(output.filename || output.name || "3d-model.spz");
    const modelExt = path.extname(outputName).toLowerCase() || ".spz";
    const modelPath = path.join(deviceDir, `3d-model${modelExt}`);

    await downloadComfyOutput(output, modelPath);

    const finalJob: SavedJob = {
      ...pendingJob,
      modelPath,
      modelExt,
      comfyPromptId: promptId,
      comfyOutput: output,
    };
    writeJob(deviceId, finalJob);

    return NextResponse.json({
      ok: true,
      jobId,
      label: "3D Model",
      sourceField: uploaded.sourceField,
      modelUrl: `/api/file?path=${encodeURIComponent(modelPath)}`,
      file: path.basename(modelPath),
      modelExt,
      contentType: modelContentType(modelPath),
      previewSupported: modelExt === ".glb" || modelExt === ".gltf" || modelExt === ".spz",
      assetType: modelExt === ".spz" ? "gaussian_splat" : "mesh",
      spzSupported: modelExt === ".spz",
      source: "triposplat_comfyui",
      textured: false,
      workflowPath: WORKFLOW_PATH,
      comfyUrl: COMFY_URL,
      comfyPromptId: promptId,
      comfyOutput: output,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        label: "3D Model",
        error: error?.message || "Unhandled error in /api/angles/model-3d",
      },
      { status: 500 }
    );
  }
}
