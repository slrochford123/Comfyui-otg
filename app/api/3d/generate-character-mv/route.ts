import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { loadWorkflowById, extractPromptGraph, validatePromptGraph } from "@/lib/workflows";
import { prepareCharacterView } from "@/app/api/3d/_lib/characterMultiview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type HistoryFile = { filename: string; subfolder?: string; type?: string };

type PreparedLocalView = {
  label: "front" | "back" | "left" | "right";
  originalPath: string;
  processedPath: string;
  uploadedName: string;
  note: string;
  changed: boolean;
};

const DEFAULT_TRELLIS_COMFY_URL = "http://100.109.254.63:8188";
const WORKFLOW_ID = "internal/angles_3d_trellis2_character_mv_textured_glb";
const MODEL_EXT_RE = /\.(glb|gltf|obj|stl|ply|fbx|usdz|zip)(?:$|\?)/i;
const MAX_I32_SEED = 2_147_483_647;
const DEFAULT_POLL_MAX_MS = 45 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const VIEW_LABELS = ["front", "back", "left", "right"] as const;

type ViewLabel = (typeof VIEW_LABELS)[number];

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

function ensureDirSync(p: string) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}

function safeDeviceId(raw: string | null) {
  const v = (raw || "").toString().trim();
  const cleaned = v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return cleaned || "local";
}

function normalizeBase(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function parseBool(value: FormDataEntryValue | null, fallback = false) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function randSeed() {
  return Math.floor(Math.random() * MAX_I32_SEED);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
  const health = await fetchStage(`${baseUrl}/system_stats`, { method: "GET" }, "char_mv_healthcheck", 10_000);
  const parsed = await readJsonOrText(health);
  if (!health.ok) {
    throw new StageError(
      "char_mv_healthcheck",
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

  return { filename, subfolder: parts.join("/"), type: "output" };
}

async function fetchComfyViewBytes(baseUrl: string, f: HistoryFile) {
  const filename = encodeURIComponent(f.filename);
  const type = encodeURIComponent(f.type || "output");
  const subfolder = encodeURIComponent(f.subfolder || "");
  const url = `${baseUrl}/view?filename=${filename}&type=${type}&subfolder=${subfolder}`;

  const r = await fetchStage(url, { method: "GET" }, "char_mv_fetch_output", 60_000);
  if (!r.ok) {
    const parsed = await readJsonOrText(r);
    throw new StageError(
      "char_mv_fetch_output",
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

async function uploadPreparedView(baseUrl: string, filePath: string, uploadName: string) {
  const bytes = await fs.readFile(filePath);
  const up = new FormData();
  up.append("image", new Blob([bytes], { type: "image/png" }), uploadName);
  up.append("type", "input");
  up.append("overwrite", "true");

  const upRes = await fetchStage(`${baseUrl}/upload/image`, { method: "POST", body: up }, "char_mv_upload", 60_000);
  const upParsed = await readJsonOrText(upRes);
  const upJson: any = upParsed.json;
  if (!upRes.ok || !upJson?.name) {
    throw new StageError(
      "char_mv_upload",
      upJson?.error || `Comfy upload failed (${upRes.status}).`,
      upRes.status,
      upJson ?? upParsed.text
    );
  }
  return upJson.subfolder
    ? `${String(upJson.subfolder).replace(/^\/+|\/+$/g, "")}/${upJson.name}`
    : String(upJson.name);
}

function safeFilename(base: string, ext = ".png") {
  const stem = String(base || "file").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "file";
  return `${stem}${ext}`;
}

export async function POST(req: NextRequest) {
  let ownerKey = "local";
  try {
    const owner = await getOwnerContext(req);
    ownerKey = owner.ownerKey;
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }

  try {
    const deviceId = safeDeviceId(req.headers.get("x-otg-device-id"));
    const COMFY_BASE_URL = normalizeBase(process.env.OTG_ANGLES_TRELLIS_COMFY_URL || DEFAULT_TRELLIS_COMFY_URL);
    const comfyClientId = `${deviceId}-char-mv-trellis2`;
    const pollMaxMs = parsePositiveInt(process.env.OTG_ANGLES_TRELLIS_MAX_MS, DEFAULT_POLL_MAX_MS);
    const pollIntervalMs = parsePositiveInt(process.env.OTG_ANGLES_TRELLIS_POLL_MS, DEFAULT_POLL_INTERVAL_MS);

    const fd = await req.formData();
    const removeBackground = parseBool(fd.get("removeBackground"), true);
    const squareSize = parsePositiveInt(String(fd.get("squareSize") || "1024"), 1024);

    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const jobId = `char_mv_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const jobDir = path.join(dataRoot, "tmp", "angles_character_mv", ownerKey, jobId);
    ensureDirSync(jobDir);

    const preparedViews: PreparedLocalView[] = [];

    for (const label of VIEW_LABELS) {
      const file = fd.get(label);
      if (!file || typeof file === "string") {
        return NextResponse.json({ ok: false, error: `Missing ${label} image.` }, { status: 400 });
      }
      const sourceName = (file as any)?.name ? String((file as any).name) : `${label}.png`;
      const sourceBytes = Buffer.from(await (file as any).arrayBuffer());
      const originalPath = path.join(jobDir, `${label}_original${path.extname(sourceName) || ".png"}`);
      await fs.writeFile(originalPath, sourceBytes);

      const prepared = await prepareCharacterView(sourceBytes, {
        removeBackground,
        squareSize,
        label,
      });
      const processedPath = path.join(jobDir, `${label}_processed.png`);
      await fs.writeFile(processedPath, prepared.buffer);
      preparedViews.push({
        label,
        originalPath,
        processedPath,
        uploadedName: safeFilename(`${jobId}_${label}`, ".png"),
        note: prepared.note,
        changed: prepared.changed,
      });
    }

    const healthInfo = await assertComfyReachable(COMFY_BASE_URL);

    for (const view of preparedViews) {
      view.uploadedName = await uploadPreparedView(COMFY_BASE_URL, view.processedPath, view.uploadedName);
    }

    const wf = loadWorkflowById(WORKFLOW_ID);
    if (!wf.ok) {
      return NextResponse.json(
        { ok: false, error: `3D workflow not found: ${WORKFLOW_ID}`, detail: wf.error },
        { status: wf.status }
      );
    }

    const extracted = extractPromptGraph(wf.json);
    if (!extracted.ok) return NextResponse.json({ ok: false, error: extracted.error }, { status: 400 });
    const validated = validatePromptGraph(extracted.graph);
    if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });

    const graph: any = JSON.parse(JSON.stringify(extracted.graph));
    const sharedSeed = randSeed();
    const prefix = `otg_tmp_angles/${deviceId}/char_mv_${Date.now()}`;

    const uploadedByLabel = Object.fromEntries(preparedViews.map((v) => [v.label, v.uploadedName])) as Record<ViewLabel, string>;

    graph["2"].inputs.image = uploadedByLabel.front;
    graph["3"].inputs.image = uploadedByLabel.back;
    graph["4"].inputs.image = uploadedByLabel.left;
    graph["5"].inputs.image = uploadedByLabel.right;
    graph["9"].inputs.seed = sharedSeed;
    graph["9"].inputs.pipeline_type = String(fd.get("pipelineType") || process.env.OTG_TRELLIS_MV_PIPELINE_TYPE || "1024_cascade");
    graph["9"].inputs.sparse_structure_steps = parsePositiveInt(String(fd.get("sparseStructureSteps") || process.env.OTG_TRELLIS_MV_SPARSE_STEPS || "12"), 12);
    graph["9"].inputs.shape_steps = parsePositiveInt(String(fd.get("shapeSteps") || process.env.OTG_TRELLIS_MV_SHAPE_STEPS || "30"), 30);
    graph["9"].inputs.texture_steps = parsePositiveInt(String(fd.get("textureSteps") || process.env.OTG_TRELLIS_MV_TEXTURE_STEPS || "25"), 25);
    graph["9"].inputs.max_num_tokens = parsePositiveInt(String(fd.get("maxNumTokens") || process.env.OTG_TRELLIS_MV_MAX_TOKENS || "49152"), 49152);
    graph["9"].inputs.max_views = 4;
    graph["9"].inputs.sparse_structure_resolution = parsePositiveInt(String(fd.get("sparseStructureResolution") || process.env.OTG_TRELLIS_MV_SPARSE_RES || "32"), 32);
    graph["9"].inputs.generate_texture_slat = true;
    graph["9"].inputs.use_tiled_decoder = parseBool(fd.get("useTiledDecoder"), true);
    graph["9"].inputs.sampler = String(fd.get("sampler") || process.env.OTG_TRELLIS_MV_SAMPLER || "euler");
    graph["13"].inputs.filename_prefix = prefix;

    if (process.env.OTG_TRELLIS_MODELNAME) graph["1"].inputs.modelname = process.env.OTG_TRELLIS_MODELNAME;
    if (process.env.OTG_TRELLIS_BACKEND) graph["1"].inputs.backend = process.env.OTG_TRELLIS_BACKEND;
    if (process.env.OTG_TRELLIS_DEVICE) graph["1"].inputs.device = process.env.OTG_TRELLIS_DEVICE;

    const submit = await fetchStage(
      `${COMFY_BASE_URL}/prompt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: graph, client_id: comfyClientId }),
      },
      "char_mv_submit_prompt",
      30_000
    );

    const submitParsed = await readJsonOrText(submit);
    const submitJson: any = submitParsed.json;
    if (!submit.ok || !submitJson?.prompt_id) {
      throw new StageError(
        "char_mv_submit_prompt",
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
      const histRes = await fetchStage(`${COMFY_BASE_URL}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, "char_mv_poll_history", 20_000);
      const histParsed = await readJsonOrText(histRes);
      const histJson: any = histParsed.json;
      if (!histRes.ok) {
        throw new StageError(
          "char_mv_poll_history",
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
        "char_mv_poll_history",
        "Timed out waiting for character multiview GLB output.",
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
    const outputDir = path.join(dataRoot, "tmp", "angles_trellis", ownerKey, jobId);
    ensureDirSync(outputDir);
    const localPath = path.join(outputDir, glbFile.filename);
    await fs.writeFile(localPath, bytes);

    return NextResponse.json(
      {
        ok: true,
        jobId,
        promptId,
        endpoint: COMFY_BASE_URL,
        workflowId: WORKFLOW_ID,
        system: healthInfo,
        modelUrl: `/api/file?path=${encodeURIComponent(localPath)}`,
        modelExt: path.extname(glbFile.filename) || ".glb",
        previewSupported: true,
        views: Object.fromEntries(
          preparedViews.map((v) => [v.label, {
            originalUrl: `/api/file?path=${encodeURIComponent(v.originalPath)}`,
            processedUrl: `/api/file?path=${encodeURIComponent(v.processedPath)}`,
            note: v.note,
            changed: v.changed,
          }])
        ),
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
