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
const DEFAULT_TIMEOUT_MS = Number(process.env.OTG_HUNYUAN_GRADIO_TIMEOUT_MS || 1000 * 60 * 12);

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
  dependencies: Array<{
    id?: number;
    inputs?: number[];
    outputs?: number[];
    targets?: Array<[number, string] | number>;
    api_name?: string | null;
  }>;
};

type TexturedMeshCandidate = {
  filePath: string;
  htmlPath: string | null;
  mtimeMs: number;
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

async function readJobId(req: NextRequest): Promise<string> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    return String(body?.jobId || body?.job_id || "").trim();
  }

  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    const formData = await req.formData();
    return String(formData.get("jobId") || formData.get("job_id") || "").trim();
  }

  return "";
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

function getAllJobFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];

  const walk = (dir: string, depth: number) => {
    if (depth > 8) return;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) out.push(full);
    }
  };

  walk(root, 0);
  return out;
}

function readJobById(jobId: string): SavedJob | null {
  const safeJobId = sanitizeName(jobId);

  for (const file of getAllJobFiles(TMP_ROOT)) {
    if (path.basename(file, ".json") !== safeJobId) continue;

    try {
      const job = JSON.parse(fs.readFileSync(file, "utf8")) as SavedJob;
      if (job?.jobId === jobId) return job;
    } catch {
      // ignore bad job file
    }
  }

  return null;
}

function writeJob(deviceId: string, job: SavedJob) {
  const jobsDir = path.join(TMP_ROOT, deviceId, "jobs");
  ensureDir(jobsDir);
  fs.writeFileSync(path.join(jobsDir, `${job.jobId}.json`), JSON.stringify(job, null, 2), "utf8");
}

async function fetchConfig(): Promise<GradioConfig> {
  const resp = await fetch(`${GRADIO_ROOT}/config`, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to fetch Gradio config (${resp.status})`);
  return (await resp.json()) as GradioConfig;
}

function getButtonIdByLabel(config: GradioConfig, label: string) {
  const component = config.components.find((c) => c.props?.value === label);
  return component?.id ?? null;
}

function getDependencyForButton(config: GradioConfig, buttonId: number) {
  return (
    config.dependencies.find(
      (dep) =>
        Array.isArray(dep.targets) &&
        dep.targets.some((target: any) => (Array.isArray(target) ? target[0] === buttonId : target === buttonId))
    ) || null
  );
}

function getDependencyByApiName(config: GradioConfig, apiName: string) {
  return config.dependencies.find((dep) => dep.api_name === apiName) || null;
}

async function queueJoin(fnIndex: number, triggerId: number | null, data: any[], sessionHash: string) {
  const body: Record<string, any> = {
    data,
    event_data: null,
    fn_index: fnIndex,
    session_hash: sessionHash,
  };

  if (typeof triggerId === "number") body.trigger_id = triggerId;

  const resp = await fetch(`${GRADIO_ROOT}/gradio_api/queue/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
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

    if (!resp.ok || !resp.body) throw new Error(`Failed to read Gradio queue data (${resp.status})`);

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

          if (payload?.msg === "process_completed") return payload;

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

function collectGlbPaths(value: any, out: string[] = []) {
  if (!value) return out;

  if (typeof value === "string") {
    if (value.toLowerCase().endsWith(".glb")) out.push(value);
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectGlbPaths(item, out);
    return out;
  }

  if (typeof value === "object") {
    if (typeof value.path === "string" && value.path.toLowerCase().endsWith(".glb")) {
      out.push(value.path);
    }

    if (value.value && typeof value.value.path === "string" && value.value.path.toLowerCase().endsWith(".glb")) {
      out.push(value.value.path);
    }

    for (const child of Object.values(value)) collectGlbPaths(child, out);
  }

  return out;
}

function extractTexturedPathFromProcessCompleted(payload: any) {
  const paths = Array.from(new Set(collectGlbPaths(payload)));

  return (
    paths.find((p) => path.basename(p).toLowerCase() === "textured_mesh.glb") ||
    paths.find((p) => p.toLowerCase().includes("textured") && p.toLowerCase().endsWith(".glb")) ||
    ""
  );
}

function findLatestTexturedMesh(cacheRoot: string, minMtimeMs: number): TexturedMeshCandidate | null {
  if (!fs.existsSync(cacheRoot)) return null;

  let best: TexturedMeshCandidate | null = null;

  const walk = (dir: string, depth: number) => {
    if (depth > 8) return;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      if (entry.name.toLowerCase() !== "textured_mesh.glb") continue;

      const mtimeMs = newestMtimeMs(full);
      if (mtimeMs < minMtimeMs) continue;

      if (!best || mtimeMs > best.mtimeMs) {
        const htmlPath = fs.existsSync(path.join(path.dirname(full), "textured_mesh.html"))
          ? path.join(path.dirname(full), "textured_mesh.html")
          : null;

        best = { filePath: full, htmlPath, mtimeMs };
      }
    }
  };

  walk(cacheRoot, 0);
  return best;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const jobId = await readJobId(req);

    if (!jobId) {
      return NextResponse.json({ ok: false, error: "Missing jobId" }, { status: 400 });
    }

    const job = readJobById(jobId);

    if (!job) {
      return NextResponse.json({ ok: false, error: "Could not find base 3D job record", jobId, tmpRoot: TMP_ROOT }, { status: 404 });
    }

    if (!job.sourceImagePath || !fs.existsSync(job.sourceImagePath)) {
      return NextResponse.json({ ok: false, error: "Base job source image is missing", jobId, sourceImagePath: job.sourceImagePath }, { status: 404 });
    }

    const sourceStat = fs.statSync(job.sourceImagePath);
    const deviceId = sanitizeName(job.deviceId || "default-device");
    const deviceDir = path.join(TMP_ROOT, deviceId);
    ensureDir(deviceDir);

    const config = await fetchConfig();

    const texturedButtonId =
      getButtonIdByLabel(config, "Gen Textured Shape") ??
      getButtonIdByLabel(config, "Gen Textured") ??
      getButtonIdByLabel(config, "Generate Textured Shape");

    let dep = texturedButtonId != null ? getDependencyForButton(config, texturedButtonId) : null;
    if (!dep) dep = getDependencyByApiName(config, "generation_all");

    if (!dep || typeof dep.id !== "number") {
      throw new Error('Could not find Hunyuan "Gen Textured Shape" dependency');
    }

    const triggerId = texturedButtonId ?? 19;
    const sessionHash = crypto.randomBytes(8).toString("hex");

    const fileData = buildFileData(
      job.sourceImagePath,
      job.sourceImageName || path.basename(job.sourceImagePath),
      job.sourceMimeType || "image/png",
      job.sourceSize || sourceStat.size
    );

    const data = [
      "",
      fileData,
      null,
      null,
      null,
      null,
      5,
      5,
      Math.floor(Math.random() * 9999999),
      256,
      true,
      8000,
      true,
    ];

    const join = await queueJoin(dep.id, triggerId, data, sessionHash);
    const completed = await waitForQueueResult(sessionHash, DEFAULT_TIMEOUT_MS);

    const directOutputPath = extractTexturedPathFromProcessCompleted(completed);

    let chosenPath = "";
    let gradioHtmlPath = "";
    let matchMode = "direct-output";
    let gradioMeshMtimeMs = 0;

    if (directOutputPath && fs.existsSync(directOutputPath)) {
      chosenPath = directOutputPath;
      gradioMeshMtimeMs = newestMtimeMs(directOutputPath);

      const htmlPath = path.join(path.dirname(directOutputPath), "textured_mesh.html");
      gradioHtmlPath = fs.existsSync(htmlPath) ? htmlPath : "";
    } else {
      const fallback = findLatestTexturedMesh(GRADIO_CACHE_ROOT, newestMtimeMs(job.sourceImagePath));

      if (!fallback) {
        return NextResponse.json(
          {
            ok: false,
            error: "Gradio textured job finished but no textured_mesh.glb was found",
            jobId,
            gradioRoot: GRADIO_ROOT,
            gradioCacheRoot: GRADIO_CACHE_ROOT,
            directOutputPath,
            allReturnedGlbs: collectGlbPaths(completed),
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

    const texturedModelPath = path.join(deviceDir, `${Date.now()}_textured_mesh.glb`);
    fs.copyFileSync(chosenPath, texturedModelPath);

    const finalJob: SavedJob = {
      ...job,
      texturedModelPath,
      gradioEventId: join?.event_id || job.gradioEventId || null,
    };

    writeJob(deviceId, finalJob);

    return NextResponse.json({
      ok: true,
      jobId,
      modelUrl: `/api/file?path=${encodeURIComponent(texturedModelPath)}`,
      file: path.basename(texturedModelPath),
      modelExt: ".glb",
      previewSupported: true,
      source: "hunyuan_gradio_queue",
      textured: true,
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
        error: error?.message || "Unhandled error in /api/angles/model-3d-texture",
      },
      { status: 500 }
    );
  }
}
