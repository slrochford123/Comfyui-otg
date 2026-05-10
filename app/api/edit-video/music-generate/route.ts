import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { configuredVideoComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type AceModel = "turbo" | "base" | "sft";

type Body = Record<string, unknown> & {
  model?: unknown;
  prompt?: unknown;
  musicPrompt?: unknown;
  tags?: unknown;
  vibe?: unknown;
  musicGeneratorPrompt?: unknown;
  generationPrompt?: unknown;
  title?: unknown;
  durationSeconds?: unknown;
  bpm?: unknown;
  keyscale?: unknown;
  seed?: unknown;
};

type HistoryFile = {
  filename: string;
  subfolder?: string;
  type?: string;
  nodeId?: string;
};

const AUDIO_EXT_RE = /\.(mp3|wav|flac|m4a|aac|ogg)$/i;
const POLL_MAX_MS = Math.max(60_000, Number(process.env.OTG_EDIT_VIDEO_MUSIC_MAX_MS || 15 * 60 * 1000));
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.OTG_EDIT_VIDEO_MUSIC_POLL_MS || 1500));
const VIEW_MAX_ATTEMPTS = Math.max(3, Number(process.env.OTG_EDIT_VIDEO_MUSIC_VIEW_MAX_ATTEMPTS || 12));
const VIEW_RETRY_MS = Math.max(750, Number(process.env.OTG_EDIT_VIDEO_MUSIC_VIEW_RETRY_MS || 1250));

const WORKFLOWS: Record<AceModel, string> = {
  turbo: "comfy_workflows/internal/edit-video/ace_step1_5_xl_turbo.json",
  base: "comfy_workflows/internal/edit-video/ace_step1_5_xl_base.json",
  sft: "comfy_workflows/internal/edit-video/ace_step1_5_xl_sft.json",
};

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeBaseUrl(raw: string) {
  return String(raw || "").trim().replace(/\/+$/, "");
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

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function basenameOnly(value: string) {
  return String(value || "").replace(/\\/g, "/").split("/").pop() || String(value || "");
}

function cleanTitle(value: string) {
  return String(value || "generated_music")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "generated_music";
}

function normalizeModel(value: unknown): AceModel {
  const raw = String(value || "turbo").toLowerCase();
  if (raw === "base") return "base";
  if (raw === "sft") return "sft";
  return "turbo";
}

function loadWorkflow(model: AceModel) {
  const rel = WORKFLOWS[model];
  const abs = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(abs)) {
    throw new StageError("load_workflow", `ACE-Step workflow file was not found: ${rel}`, 500);
  }
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function setNodeInput(graph: any, nodeId: string, patch: Record<string, unknown>) {
  if (!graph || typeof graph !== "object") return;
  const node = graph[nodeId];
  if (!node || typeof node !== "object") return;
  node.inputs = { ...(node.inputs || {}), ...patch };
}

function buildGraph(params: {
  model: AceModel;
  prompt: string;
  title: string;
  durationSeconds: number;
  bpm: number;
  keyscale: string;
  seed: number;
  filenamePrefix: string;
}) {
  const graph = loadWorkflow(params.model);
  setNodeInput(graph, "94", {
    tags: params.prompt,
    lyrics: "undefined",
    duration: params.durationSeconds,
    bpm: params.bpm,
    keyscale: params.keyscale,
    language: "en",
    timesignature: "4",
    generate_audio_codes: true,
  });
  // OTG_PHASE3B_ACE_SECONDS_FIX: EmptyAceStep1.5LatentAudio node 98 requires a numeric seconds value.
  // Without this, ComfyUI rejects the prompt with: seconds, None, float() argument must be a string or real number.
  setNodeInput(graph, "98", { seconds: params.durationSeconds, batch_size: 1 });
  setNodeInput(graph, "109", { value: params.seed });
  setNodeInput(graph, "107", { filename_prefix: params.filenamePrefix, quality: "V0" });
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
      collectHistoryFiles(child, out, /^\d+$/.test(String(key)) ? String(key) : currentNodeId);
    }
  }
  return out;
}

function scoreHistoryFile(item: HistoryFile, expectedPrefix?: string) {
  let score = 0;
  const name = String(item.filename || "").toLowerCase();
  if (expectedPrefix) {
    const prefix = String(expectedPrefix).toLowerCase();
    if (name.startsWith(prefix)) score += 100;
    else if (name.includes(prefix)) score += 75;
  }
  if (item.nodeId === "107") score += 50;
  if (name.endsWith(".mp3")) score += 20;
  if (name.includes("ace")) score += 10;
  return score;
}

function pickAudioHistoryFile(historyJson: any, expectedPrefix?: string) {
  const all = collectHistoryFiles(historyJson, []).filter((item) => AUDIO_EXT_RE.test(item.filename));
  if (!all.length) return null;
  return all.slice().sort((a, b) => scoreHistoryFile(b, expectedPrefix) - scoreHistoryFile(a, expectedPrefix))[0] || null;
}

async function pollHistoryForAudio(baseUrl: string, promptId: string, expectedPrefix?: string) {
  const started = Date.now();
  let lastPayload: any = null;

  while (Date.now() - started < POLL_MAX_MS) {
    const res = await fetchStage(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, "poll_history", 25_000);
    const parsed = await readJsonOrText(res);
    if (res.ok && parsed.json) {
      lastPayload = parsed.json;
      const promptBlock = (parsed.json as any)?.[promptId] ?? parsed.json;
      const hit = pickAudioHistoryFile(promptBlock, expectedPrefix);
      if (hit) return { file: hit, historyPayload: parsed.json };
    }

    const allRes = await fetchStage(`${baseUrl}/history`, { method: "GET" }, "poll_history_all", 25_000);
    const allParsed = await readJsonOrText(allRes);
    if (allRes.ok && allParsed.json) {
      lastPayload = allParsed.json;
      const block = (allParsed.json as any)?.[promptId];
      const hit = pickAudioHistoryFile(block, expectedPrefix);
      if (hit) return { file: hit, historyPayload: allParsed.json };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new StageError("poll_history", `Timed out waiting for ACE-Step audio output for prompt ${promptId}.`, 504, lastPayload);
}

async function fetchViewBinary(baseUrl: string, file: HistoryFile) {
  const params = new URLSearchParams();
  params.set("filename", file.filename);
  if (file.subfolder) params.set("subfolder", file.subfolder);
  if (file.type) params.set("type", file.type);

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

  throw new StageError("fetch_view", `Failed to fetch generated ACE-Step audio after ${VIEW_MAX_ATTEMPTS} attempts.`, lastStatus, lastDetail?.json ?? lastDetail?.text);
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

async function copyOrFetchAudio(baseUrl: string, file: HistoryFile, ownerKey: string, title: string) {
  const existing = resolveExistingComfyOutputPath(file);
  const sourceName = basenameOnly(file.filename) || `${title}.mp3`;
  const ext = AUDIO_EXT_RE.test(sourceName) ? path.extname(sourceName).toLowerCase() : ".mp3";
  const ownerSafe = safeSegment(ownerKey || "local");
  const outputDir = path.join(OTG_DATA_ROOT, "edit_video", "music", ownerSafe, "generated");
  ensureDir(outputDir);
  const outName = `${Date.now()}_${cleanTitle(title)}${ext}`;
  const outPath = path.join(outputDir, outName);

  if (existing) {
    await fsp.copyFile(existing, outPath);
  } else {
    const bytes = await fetchViewBinary(baseUrl, file);
    await fsp.writeFile(outPath, bytes);
  }

  return outPath;
}

function pickPromptFromBody(body: Body) {
  const orderedKeys = [
    "prompt",
    "musicPrompt",
    "musicGeneratorPrompt",
    "generationPrompt",
    "tags",
    "vibe",
    "description",
    "text",
  ];

  for (const key of orderedKeys) {
    const value = body?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  const excluded = new Set(["model", "title", "key", "keyscale", "seed", "bpm", "duration", "durationSeconds"]);
  for (const [key, value] of Object.entries(body || {})) {
    if (excluded.has(key)) continue;
    if (typeof value === "string" && value.trim().length >= 3) return value.trim();
  }

  return "";
}

async function parseMusicGenerateBody(req: NextRequest) {
  const rawText = await req.text().catch(() => "");
  if (!rawText.trim()) return { body: {} as Body, rawText };
  try {
    return { body: JSON.parse(rawText) as Body, rawText };
  } catch {
    return { body: {} as Body, rawText };
  }
}

export async function POST(req: NextRequest) {
  try {
    // OTG_PHASE3B_REQUEST_READ_ORDER_FIX: read the request body before owner/session helpers.
    // Some helpers may touch the request stream, which leaves req.text()/req.json() empty afterward.
    const { body, rawText } = await parseMusicGenerateBody(req);
    const { ownerKey } = await getOwnerContext(req);

    const model = normalizeModel(body.model);
    // OTG_PHASE3B_PROMPT_BODY_FIX: accept current and future frontend prompt keys and expose diagnostics.
    const prompt = pickPromptFromBody(body);
    if (!prompt) {
      return NextResponse.json(
        {
          ok: false,
          error: "Music prompt is required.",
          stage: "validate_prompt",
          receivedKeys: Object.keys(body || {}),
          contentType: req.headers.get("content-type") || "",
          rawBodyLength: rawText.length,
          rawBodyPreview: rawText.slice(0, 500),
          bodyUsedAfterParse: req.bodyUsed,
        },
        { status: 400 }
      );
    }

    const title = cleanTitle(String(body.title || "generated_music"));
    const durationSeconds = clamp(Math.floor(Number(body.durationSeconds) || 30), 5, 180);
    const bpm = clamp(Math.floor(Number(body.bpm) || 95), 40, 220);
    const keyscale = String(body.keyscale || "E minor").trim() || "E minor";
    const rawSeed = Number(body.seed);
    const seed = Number.isFinite(rawSeed) && rawSeed >= 0 ? Math.floor(rawSeed) : Math.floor(Math.random() * 2147483647);
    const filenamePrefix = `audio/ace_step_${model}_${Date.now()}_${title}`;

    const graph = buildGraph({ model, prompt, title, durationSeconds, bpm, keyscale, seed, filenamePrefix });
    const comfyBaseUrl = normalizeBaseUrl(configuredVideoComfyBaseUrl() || "http://127.0.0.1:8188");
    const clientId = `otg_edit_video_music_${Date.now()}`;

    const submit = await fetchStage(`${comfyBaseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    }, "submit_prompt", 60_000);

    const submitParsed = await readJsonOrText(submit);
    if (!submit.ok || !submitParsed.json?.prompt_id) {
      throw new StageError("submit_prompt", submitParsed.json?.error || `ComfyUI did not return a prompt_id (${submit.status}).`, submit.status, submitParsed.json || submitParsed.text);
    }

    const promptId = String(submitParsed.json.prompt_id);
    const historyHit = await pollHistoryForAudio(comfyBaseUrl, promptId, path.basename(filenamePrefix));
    const localPath = await copyOrFetchAudio(comfyBaseUrl, historyHit.file, ownerKey, title);
    const stat = fs.statSync(localPath);

    return NextResponse.json({
      ok: true,
      jobId: promptId,
      promptId,
      model,
      title,
      prompt,
      fileName: path.basename(localPath),
      audioPath: localPath,
      url: `/api/file?path=${encodeURIComponent(localPath)}`,
      durationSeconds,
      bpm,
      keyscale,
      seed,
      sizeBytes: stat.size,
      remoteFile: historyHit.file,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const stage = e instanceof StageError ? e.stage : "music_generate";
    const status = e instanceof StageError && e.status ? e.status : 500;
    const detail = e instanceof StageError ? e.detail : undefined;
    return NextResponse.json({ ok: false, error: e?.message || "Generate music failed", stage, detail }, { status });
  }
}
