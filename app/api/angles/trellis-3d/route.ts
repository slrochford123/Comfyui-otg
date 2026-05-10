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

const DEFAULT_TRELLIS_COMFY_URL = "http://100.109.254.63:8188";
const TRELLIS_WORKFLOW_ID = "internal/angles_3d_trellis2_textured_glb";
const MODEL_EXT_RE = /\.(glb|gltf|obj|stl|ply|fbx|usdz|zip)(?:$|\?)/i;
const MAX_I32_SEED = 2_147_483_647;
const DEFAULT_POLL_MAX_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2_500;

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

function randSeed() {
  return Math.floor(Math.random() * MAX_I32_SEED);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeBase(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function parseBool(value: FormDataEntryValue | null) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}


function parseSubjectType(value: FormDataEntryValue | null): "prop" | "character" {
  return String(value || "").trim().toLowerCase() === "character" ? "character" : "prop";
}

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
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
    const msg = e?.name === "AbortError" ? `Request timed out after ${timeoutMs}ms.` : (e?.message || String(e));
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
  const health = await fetchStage(`${baseUrl}/system_stats`, { method: "GET" }, "trellis_healthcheck", 10_000);
  const parsed = await readJsonOrText(health);
  if (!health.ok) {
    throw new StageError(
      "trellis_healthcheck",
      `Remote Comfy healthcheck failed (${health.status}).`,
      health.status,
      parsed.json ?? parsed.text
    );
  }
  return parsed.json ?? parsed.text;
}

function pushHistoryFile(out: HistoryFile[], x: any) {
  if (!x || typeof x !== "object") return;
  if (!x.filename) return;
  out.push({
    filename: String(x.filename),
    subfolder: x.subfolder ? String(x.subfolder) : "",
    type: x.type ? String(x.type) : "output",
  });
}

function extractAnyFilesFromHistory(record: any): HistoryFile[] {
  const out: HistoryFile[] = [];
  const seen = new Set<string>();
  const outputs = record?.outputs;
  if (!outputs || typeof outputs !== "object") return out;

  const visit = (value: any) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;

    if (value.filename) {
      const hf = {
        filename: String(value.filename),
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

  visit(outputs);
  return out;
}

function extractStringPathsFromHistory(record: any): string[] {
  const out = new Set<string>();
  const outputs = record?.outputs;
  if (!outputs || typeof outputs !== "object") return [];

  const visit = (value: any) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (MODEL_EXT_RE.test(trimmed)) out.add(trimmed);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const nested of Object.values(value)) visit(nested);
    }
  };

  visit(outputs);
  return [...out];
}

function historyFileFromPath(rawPath: string): HistoryFile | null {
  const cleaned = String(rawPath || "").trim().replace(/\\/g, "/");
  if (!MODEL_EXT_RE.test(cleaned)) return null;

  let relative = cleaned;
  const outputMarker = "/output/";
  const idx = cleaned.toLowerCase().lastIndexOf(outputMarker);
  if (idx >= 0) {
    relative = cleaned.slice(idx + outputMarker.length);
  } else if (path.posix.isAbsolute(cleaned)) {
    return null;
  }

  const parts = relative.split("/").filter(Boolean);
  if (!parts.length) return null;
  const filename = parts.pop() || "";
  if (!filename) return null;

  return {
    filename,
    subfolder: parts.join("/"),
    type: "output",
  };
}

async function fetchComfyViewBytes(baseUrl: string, f: HistoryFile) {
  const filename = encodeURIComponent(f.filename);
  const type = encodeURIComponent(f.type || "output");
  const subfolder = encodeURIComponent(f.subfolder || "");
  const url = `${baseUrl}/view?filename=${filename}&type=${type}&subfolder=${subfolder}`;

  const r = await fetchStage(url, { method: "GET" }, "trellis_fetch_output", 60_000);
  if (!r.ok) {
    const parsed = await readJsonOrText(r);
    throw new StageError(
      "trellis_fetch_output",
      `Comfy /view failed (${r.status}) for ${f.filename}.`,
      r.status,
      parsed.json ?? parsed.text
    );
  }
  return Buffer.from(await r.arrayBuffer());
}

function summarizeHistory(record: any) {
  const outputs = record?.outputs && typeof record.outputs === "object" ? record.outputs : {};
  const files = extractAnyFilesFromHistory(record);
  const paths = extractStringPathsFromHistory(record);
  return {
    status: record?.status ?? null,
    nodeIds: Object.keys(outputs),
    files,
    paths,
  };
}

function findModelFile(record: any, expectedPrefix: string): { file: HistoryFile | null; candidates: HistoryFile[] } {
  const candidates: HistoryFile[] = [];
  const pushUnique = (hf: HistoryFile | null) => {
    if (!hf) return;
    if (!MODEL_EXT_RE.test(hf.filename)) return;
    const key = `${hf.type || "output"}|${hf.subfolder || ""}|${hf.filename}`;
    if (candidates.some((x) => `${x.type || "output"}|${x.subfolder || ""}|${x.filename}` === key)) return;
    candidates.push(hf);
  };

  for (const hf of extractAnyFilesFromHistory(record)) pushUnique(hf);
  for (const rawPath of extractStringPathsFromHistory(record)) pushUnique(historyFileFromPath(rawPath));

  const prefixBase = path.posix.basename(expectedPrefix);
  const preferred = candidates.find((hf) => {
    const subfolder = (hf.subfolder || "").replace(/\\/g, "/");
    return hf.filename.toLowerCase().endsWith(".glb") && subfolder.includes("otg_tmp_angles") && hf.filename.startsWith(prefixBase);
  });
  if (preferred) return { file: preferred, candidates };

  const anyGlb = candidates.find((hf) => hf.filename.toLowerCase().endsWith(".glb"));
  return { file: anyGlb || null, candidates };
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
    const COMFY_BASE_URL = normalizeBase(process.env.OTG_ANGLES_TRELLIS_COMFY_URL || DEFAULT_TRELLIS_COMFY_URL);
    const comfyClientId = `${deviceId}-angles3d-trellis2`;
    const pollMaxMs = parsePositiveInt(process.env.OTG_ANGLES_TRELLIS_MAX_MS, DEFAULT_POLL_MAX_MS);
    const pollIntervalMs = parsePositiveInt(process.env.OTG_ANGLES_TRELLIS_POLL_MS, DEFAULT_POLL_INTERVAL_MS);

    const fd = await req.formData();
    const file = fd.get("image");
    const removeBackground = parseBool(fd.get("removeBackground"));
    const subjectType = parseSubjectType(fd.get("subjectType"));
    if (!file || typeof file === "string") {
      return NextResponse.json({ ok: false, error: "Missing image file" }, { status: 400 });
    }

    let uploadName = (file as any)?.name ? String((file as any).name) : `otg_trellis2_${Date.now()}.png`;
    let uploadBytes = Buffer.from(await (file as any).arrayBuffer());
    let preprocessNote = subjectType === "character"
      ? "Using original image. Character mode works best with a centered full-body front view and separated limbs."
      : "Using original image.";

    if (removeBackground) {
      const cutout = await removeBackgroundBestEffort(uploadBytes, { subjectType });
      uploadBytes = cutout.buffer;
      uploadName = `${path.basename(uploadName, path.extname(uploadName))}_cutout.png`;
      preprocessNote = `${cutout.note} Confidence ${Math.round(cutout.confidence * 100)}%.`;
    }

    const healthInfo = await assertComfyReachable(COMFY_BASE_URL);

    const up = new FormData();
    up.append("image", new Blob([uploadBytes], { type: "image/png" }), uploadName);
    up.append("type", "input");
    up.append("overwrite", "true");

    const upRes = await fetchStage(`${COMFY_BASE_URL}/upload/image`, { method: "POST", body: up }, "trellis_upload", 60_000);
    const upParsed = await readJsonOrText(upRes);
    const upJson: any = upParsed.json;
    if (!upRes.ok || !upJson?.name) {
      throw new StageError(
        "trellis_upload",
        upJson?.error || `Comfy upload failed (${upRes.status}).`,
        upRes.status,
        upJson ?? upParsed.text
      );
    }

    const uploadedName = upJson.subfolder
      ? `${String(upJson.subfolder).replace(/^\/+|\/+$/g, "")}/${upJson.name}`
      : String(upJson.name);

    const wf = loadWorkflowById(TRELLIS_WORKFLOW_ID);
    if (!wf.ok) {
      return NextResponse.json(
        { ok: false, error: `3D workflow not found: ${TRELLIS_WORKFLOW_ID}`, detail: wf.error },
        { status: wf.status }
      );
    }

    const extracted = extractPromptGraph(wf.json);
    if (!extracted.ok) return NextResponse.json({ ok: false, error: extracted.error }, { status: 400 });
    const validated = validatePromptGraph(extracted.graph);
    if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });

    const graph: any = JSON.parse(JSON.stringify(extracted.graph));
    const sharedSeed = randSeed();
    const prefix = `otg_tmp_angles/${deviceId}/trellis2_${Date.now()}`;

    if (graph?.["1"]?.class_type === "LoadImage" && graph["1"]?.inputs) {
      graph["1"].inputs.image = uploadedName;
    }
    if (graph?.["73"]?.class_type === "Trellis2ImageToShape" && graph["73"]?.inputs) {
      graph["73"].inputs.seed = sharedSeed;
    }
    if (graph?.["75"]?.class_type === "Trellis2ShapeToTexturedMesh" && graph["75"]?.inputs) {
      graph["75"].inputs.seed = sharedSeed;
    }
    if (graph?.["74"]?.class_type === "Trellis2ExportGLB" && graph["74"]?.inputs) {
      graph["74"].inputs.filename_prefix = prefix;
    }
    if (!graph?.["64"]) {
      graph["64"] = {
        class_type: "Preview3D",
        inputs: {
          model_file: ["74", 0],
        },
      };
    } else if (graph?.["64"]?.class_type === "Preview3D" && graph["64"]?.inputs) {
      graph["64"].inputs.model_file = ["74", 0];
    }

    const submit = await fetchStage(
      `${COMFY_BASE_URL}/prompt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: graph, client_id: comfyClientId }),
      },
      "trellis_submit_prompt",
      30_000
    );

    const submitParsed = await readJsonOrText(submit);
    const submitJson: any = submitParsed.json;
    if (!submit.ok || !submitJson?.prompt_id) {
      throw new StageError(
        "trellis_submit_prompt",
        submitJson?.error || `Comfy submit failed (${submit.status}).`,
        submit.status,
        submitJson ?? submitParsed.text
      );
    }

    const promptId = String(submitJson.prompt_id);
    const start = Date.now();
    let glbFile: HistoryFile | null = null;
    let lastHistorySummary: any = null;

    while (Date.now() - start < pollMaxMs) {
      const histRes = await fetchStage(`${COMFY_BASE_URL}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, "trellis_poll_history", 20_000);
      const histParsed = await readJsonOrText(histRes);
      const histJson: any = histParsed.json;
      if (!histRes.ok) {
        throw new StageError(
          "trellis_poll_history",
          `Comfy history failed (${histRes.status}).`,
          histRes.status,
          histJson ?? histParsed.text
        );
      }

      const record = histJson?.[promptId] ?? histJson;
      lastHistorySummary = summarizeHistory(record);
      const found = findModelFile(record, prefix);
      if (found.file) {
        glbFile = found.file;
        break;
      }

      const completed = Boolean(record?.status?.completed) || String(record?.status_str || "").toLowerCase() === "success";
      if (completed) {
        await sleep(Math.max(500, Math.min(5_000, pollIntervalMs)));
      } else {
        await sleep(pollIntervalMs);
      }
    }

    if (!glbFile) {
      throw new StageError(
        "trellis_poll_history",
        "Timed out waiting for Trellis 2 GLB output.",
        504,
        {
          promptId,
          endpoint: COMFY_BASE_URL,
          expectedPrefix: prefix,
          lastHistorySummary,
        }
      );
    }

    const bytes = await fetchComfyViewBytes(COMFY_BASE_URL, glbFile);
    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const outputDir = path.join(dataRoot, "tmp", "angles_models", deviceId);
    ensureDirSync(outputDir);
    const localPath = path.join(outputDir, glbFile.filename);
    await fs.writeFile(localPath, bytes);

    return NextResponse.json(
      {
        ok: true,
        promptId,
        endpoint: COMFY_BASE_URL,
        preprocess: preprocessNote,
        subjectType,
        system: healthInfo,
        remoteFile: glbFile,
        modelUrl: `/api/file?path=${encodeURIComponent(localPath)}`,
        modelExt: path.extname(glbFile.filename) || ".glb",
        previewSupported: true,
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
