import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_ROOT = path.resolve(process.env.OTG_DATA_DIR || path.join(process.cwd(), "data"));
const TMP_ROOT = path.join(DATA_ROOT, "tmp", "angles_models");
const GRADIO_ROOT = (process.env.OTG_HUNYUAN_GRADIO_ROOT || "http://127.0.0.1:8080").replace(/\/+$/, "");
const GRADIO_CACHE_ROOT = process.env.OTG_HUNYUAN_GRADIO_CACHE_ROOT || "C:\\AI\\Hunyuan3D-2\\gradio_cache";
const DEFAULT_TIMEOUT_MS = Number(process.env.OTG_HUNYUAN_GRADIO_TIMEOUT_MS || 1000 * 60 * 5);

type SavedJob = {
  jobId: string;
  createdAt: string;
  deviceId: string;
  sourceImagePath: string;
  sourceImageName: string;
  sourceMimeType: string;
  sourceSize: number;
  baseModelPath?: string;
  texturedModelPath?: string;
  gradioSessionHash?: string;
  gradioEventId?: string | null;
};

type GradioConfig = {
  components: Array<{ id: number; type?: string; props?: Record<string, any> }>;
  dependencies: Array<{ id?: number; inputs?: number[]; outputs?: number[]; targets?: Array<[number, string] | number>; api_name?: string | null }>;
};

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitizeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

function newestMtimeMs(filePath: string) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFileData(filePath: string, origName: string, mimeType: string, size: number) {
  return {
    path: filePath,
    url: null,
    size,
    orig_name: origName,
    mime_type: mimeType,
    is_stream: false,
    meta: { _type: "gradio.FileData" },
  };
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

function writeJob(deviceId: string, job: SavedJob) {
  const jobsDir = path.join(TMP_ROOT, deviceId, "jobs");
  ensureDir(jobsDir);
  fs.writeFileSync(path.join(jobsDir, `${job.jobId}.json`), JSON.stringify(job, null, 2), "utf8");
}

async function fetchConfig(): Promise<GradioConfig> {
  const resp = await fetch(`${GRADIO_ROOT}/config`, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`Failed to fetch Gradio config (${resp.status})`);
  }
  return (await resp.json()) as GradioConfig;
}

function getButtonIdByLabel(config: GradioConfig, label: string) {
  const component = config.components.find((c) => c.props?.value === label);
  return component?.id ?? null;
}

function getDependencyForButton(config: GradioConfig, buttonId: number) {
  return (
    config.dependencies.find((dep) =>
      Array.isArray(dep.targets) &&
      dep.targets.some((target: any) => (Array.isArray(target) ? target[0] === buttonId : target === buttonId))
    ) || null
  );
}

function getComponent(config: GradioConfig, id: number) {
  return config.components.find((c) => c.id === id) || null;
}

function inferDefaultValue(component: { type?: string; props?: Record<string, any> } | null) {
  if (!component) return null;
  const props = component.props || {};
  const label = String(props.label || "").toLowerCase();
  if (label === "image") return "__IMAGE_FILE__";
  if (["front", "back", "left", "right"].includes(label)) return null;
  if (label.includes("text prompt")) return null;
  if (Object.prototype.hasOwnProperty.call(props, "value")) return props.value;
  if (component.type === "checkbox") return false;
  return null;
}

function buildShapeInputData(config: GradioConfig, dep: NonNullable<ReturnType<typeof getDependencyForButton>>, fileData: any) {
  return (dep.inputs || []).map((id) => {
    const component = getComponent(config, id);
    const inferred = inferDefaultValue(component);
    return inferred === "__IMAGE_FILE__" ? fileData : inferred;
  });
}

async function queueJoin(fnIndex: number, triggerId: number, data: any[], sessionHash: string) {
  const resp = await fetch(`${GRADIO_ROOT}/gradio_api/queue/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      data,
      event_data: null,
      fn_index: fnIndex,
      trigger_id: triggerId,
      session_hash: sessionHash,
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
    throw new Error(json?.detail || json?.error || text || `Gradio queue join failed (${resp.status})`);
  }
  return json;
}

async function waitForQueueResult(sessionHash: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${GRADIO_ROOT}/gradio_api/queue/data?session_hash=${encodeURIComponent(sessionHash)}`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`Failed to read Gradio queue data (${resp.status})`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        const dataLines = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());

        for (const dataLine of dataLines) {
          if (!dataLine || dataLine === "[DONE]") continue;
          let payload: any = null;
          try {
            payload = JSON.parse(dataLine);
          } catch {
            continue;
          }

          if (payload?.msg === "process_completed") {
            return payload;
          }
          if (payload?.msg === "process_failed" || payload?.success === false) {
            throw new Error(payload?.error || payload?.message || "Gradio process failed");
          }
        }
      }
    }
    throw new Error("Gradio queue stream ended before process_completed");
  } finally {
    clearTimeout(timeout);
  }
}

function extractOutputPathFromProcessCompleted(payload: any, index: number) {
  const item = payload?.output?.data?.[index];
  if (item && typeof item === "object" && typeof item.path === "string" && item.path) {
    return item.path;
  }
  return "";
}

function findLatestWhiteMesh(cacheRoot: string, minMtimeMs: number) {
  if (!fs.existsSync(cacheRoot)) return null;

  let best: { filePath: string; htmlPath: string | null; mtimeMs: number; folder: string } | null = null;
  const entries = fs.readdirSync(cacheRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(cacheRoot, entry.name);
    const glbPath = path.join(folder, "white_mesh.glb");
    if (!fs.existsSync(glbPath)) continue;
    const mtimeMs = newestMtimeMs(glbPath);
    if (mtimeMs < minMtimeMs) continue;
    if (!best || mtimeMs > best.mtimeMs) {
      const htmlPath = fs.existsSync(path.join(folder, "white_mesh.html")) ? path.join(folder, "white_mesh.html") : null;
      best = { filePath: glbPath, htmlPath, mtimeMs, folder };
    }
  }
  return best;
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
    const deviceDir = path.join(TMP_ROOT, deviceId);
    ensureDir(deviceDir);

    const sourceExt = fileExtFromMime(uploaded.mimeType, uploaded.fileName);
    const savedSourceName = `${Date.now()}_${sanitizeName(path.basename(uploaded.fileName || "upload")) || "upload"}${path.extname(uploaded.fileName) ? "" : sourceExt}`;
    const sourceImagePath = path.join(deviceDir, savedSourceName);
    fs.writeFileSync(sourceImagePath, uploaded.buffer);

    const config = await fetchConfig();
    const buttonId = getButtonIdByLabel(config, "Gen Shape");
    if (buttonId == null) {
      throw new Error('Could not find "Gen Shape" button in Gradio config');
    }
    const dep = getDependencyForButton(config, buttonId);
    if (!dep || typeof dep.id !== "number") {
      throw new Error('Could not find dependency for "Gen Shape"');
    }

    const sessionHash = crypto.randomBytes(8).toString("hex");
    const fileData = buildFileData(sourceImagePath, uploaded.fileName, uploaded.mimeType, uploaded.size);
    const data = buildShapeInputData(config, dep, fileData);

    const pendingJob: SavedJob = {
      jobId,
      createdAt: new Date().toISOString(),
      deviceId,
      sourceImagePath,
      sourceImageName: uploaded.fileName,
      sourceMimeType: uploaded.mimeType,
      sourceSize: uploaded.size,
      gradioSessionHash: sessionHash,
    };
    writeJob(deviceId, pendingJob);

    const join = await queueJoin(dep.id, buttonId, data, sessionHash);
    const completed = await waitForQueueResult(sessionHash, DEFAULT_TIMEOUT_MS);
    const baseOutputPath = extractOutputPathFromProcessCompleted(completed, 0);

    let chosenPath = "";
    let gradioHtmlPath = "";
    let matchMode = "direct-output";
    let gradioMeshMtimeMs = 0;

    if (baseOutputPath && fs.existsSync(baseOutputPath)) {
      chosenPath = baseOutputPath;
      gradioMeshMtimeMs = newestMtimeMs(baseOutputPath);
      const folder = path.dirname(baseOutputPath);
      const htmlPath = path.join(folder, "white_mesh.html");
      gradioHtmlPath = fs.existsSync(htmlPath) ? htmlPath : "";
    } else {
      const fallback = findLatestWhiteMesh(GRADIO_CACHE_ROOT, newestMtimeMs(sourceImagePath));
      if (!fallback) {
        return NextResponse.json(
          {
            ok: false,
            error: "Gradio shape job finished but no white_mesh.glb was found",
            jobId,
            gradioRoot: GRADIO_ROOT,
            gradioCacheRoot: GRADIO_CACHE_ROOT,
            queueJoinResponse: join,
            queueCompletedPreview: completed,
          },
          { status: 502 }
        );
      }
      chosenPath = fallback.filePath;
      gradioHtmlPath = fallback.htmlPath || "";
      gradioMeshMtimeMs = fallback.mtimeMs;
      matchMode = "cache-fallback";
    }

    const baseModelPath = path.join(deviceDir, `${Date.now()}_white_mesh.glb`);
    fs.copyFileSync(chosenPath, baseModelPath);

    const finalJob: SavedJob = {
      ...pendingJob,
      baseModelPath,
      gradioEventId: join?.event_id || null,
    };
    writeJob(deviceId, finalJob);

    return NextResponse.json({
      ok: true,
      jobId,
      sourceField: uploaded.sourceField,
      modelUrl: `/api/file?path=${encodeURIComponent(baseModelPath)}`,
      file: path.basename(baseModelPath),
      modelExt: ".glb",
      previewSupported: true,
      source: "hunyuan_gradio_queue",
      textured: false,
      warning: null,
      gradioRoot: GRADIO_ROOT,
      gradioSourceGlb: chosenPath,
      gradioSourceHtml: gradioHtmlPath || null,
      gradioCacheRoot: GRADIO_CACHE_ROOT,
      gradioMeshMtimeMs,
      matchMode,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Unhandled error in /api/angles/model-3d",
      },
      { status: 500 }
    );
  }
}
