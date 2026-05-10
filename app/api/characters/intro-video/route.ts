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

type Body = {
  imagePath?: unknown;
  likenessDescription?: unknown;
  introLine?: unknown;
  voiceStyleDefinition?: unknown;
  characterName?: unknown;
};

type HistoryFile = {
  filename: string;
  subfolder?: string;
  type?: string;
  nodeId?: string;
};

const INTRO_VIDEO_WORKFLOW_ID = "internal/characters/character_intro_video_ltx23";
const INTRO_VIDEO_WIDTH = 720;
const INTRO_VIDEO_HEIGHT = 1280;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)$/i;
const POLL_MAX_MS = Math.max(60_000, Number(process.env.OTG_CHARACTER_INTRO_VIDEO_MAX_MS || 10 * 60 * 1000));
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.OTG_CHARACTER_INTRO_VIDEO_POLL_MS || 1500));
const VIEW_MAX_ATTEMPTS = Math.max(3, Number(process.env.OTG_CHARACTER_INTRO_VIDEO_VIEW_MAX_ATTEMPTS || 12));
const VIEW_RETRY_MS = Math.max(750, Number(process.env.OTG_CHARACTER_INTRO_VIDEO_VIEW_RETRY_MS || 1250));

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

function estimateDurationSeconds(introLine: string) {
  const words = String(introLine || "").trim().split(/\s+/).filter(Boolean).length;
  if (!words) return 5;
  return clamp(Math.ceil(words / 2.4) + 1, 5, 12);
}

function normalizeClause(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[-,:;\s]+/, "")
    .trim();
}

function withPeriod(value: string) {
  const trimmed = normalizeClause(value);
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function buildPositivePrompt(params: {
  characterName: string;
  likenessDescription: string;
  voiceStyleDefinition: string;
  introLine: string;
}) {
  const characterName = normalizeClause(params.characterName);
  const likenessDescription = withPeriod(params.likenessDescription);
  const voiceStyleDefinition = withPeriod(params.voiceStyleDefinition);
  const introLine = normalizeClause(params.introLine);
  const subject = characterName ? `${characterName} from the uploaded portrait` : "the uploaded character portrait";

  return [
    `${subject} performs a direct-to-camera LTX 2.3 image-to-video intro that stays locked to the source image identity, costume, framing, and background.`,
    likenessDescription
      ? `Likeness anchor: ${likenessDescription}`
      : "Likeness anchor: preserve the exact visible identity and appearance already present in the source image.",
    voiceStyleDefinition
      ? `Performance anchor from the voice style notes: ${voiceStyleDefinition}`
      : "Performance anchor: controlled natural speaking delivery with clean facial motion.",
    `Spoken intro line and delivery target: "${introLine}".`,
    "Natural speaking motion, subtle head motion, light breathing, expressive eyes, clean mouth movement, stable framing, no body drift, no scene change, no camera cut, no text overlay, polished cinematic motion continuity.",
    "Keep the shot focused on the character delivering the line with refined professional image quality and preserve continuity with the uploaded portrait.",
  ].join(" ");
}

const NEGATIVE_PROMPT = [
  "low quality",
  "blurry",
  "deformed face",
  "warped mouth",
  "bad mouth motion",
  "extra limbs",
  "flicker",
  "scene change",
  "camera cut",
  "text overlay",
  "subtitle",
  "cropped face",
  "duplicate subject",
].join(", ");

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
    const message =
      error?.name === "AbortError"
        ? `Request timed out after ${timeoutMs}ms.`
        : String(error?.message || error);
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

function safeVideoExt(filename: string) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  return VIDEO_EXT_RE.test(ext) ? ext : ".mp4";
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
  const name = String(item?.filename || "").toLowerCase();
  if (expectedPrefix) {
    const prefix = String(expectedPrefix || "").toLowerCase();
    if (name.startsWith(prefix)) score += 100;
    else if (name.includes(prefix)) score += 75;
  }
  if (item?.nodeId === "188") score += 40;
  if (name.includes("-audio")) score += 20;
  if (name.endsWith(".mp4")) score += 10;
  return score;
}

function pickVideoHistoryFile(historyJson: any, expectedPrefix?: string) {
  const all = collectHistoryFiles(historyJson, []).filter((item) => VIDEO_EXT_RE.test(item.filename));
  if (!all.length) return null;
  return all
    .slice()
    .sort((a, b) => scoreHistoryFile(b, expectedPrefix) - scoreHistoryFile(a, expectedPrefix))[0] || null;
}

async function pollHistoryForVideo(baseUrl: string, promptId: string, expectedPrefix?: string) {
  const started = Date.now();
  let lastPayload: any = null;

  while (Date.now() - started < POLL_MAX_MS) {
    const res = await fetchStage(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, "poll_history", 25_000);
    const parsed = await readJsonOrText(res);

    if (res.ok && parsed.json) {
      lastPayload = parsed.json;
      const promptBlock = (parsed.json as any)?.[promptId] ?? parsed.json;
      const hit = pickVideoHistoryFile(promptBlock, expectedPrefix);
      if (hit) return { file: hit, historyPayload: parsed.json };
    }

    const allRes = await fetchStage(`${baseUrl}/history`, { method: "GET" }, "poll_history_all", 25_000);
    const allParsed = await readJsonOrText(allRes);

    if (allRes.ok && allParsed.json) {
      lastPayload = allParsed.json;
      const block = (allParsed.json as any)?.[promptId];
      const hit = pickVideoHistoryFile(block, expectedPrefix);
      if (hit) return { file: hit, historyPayload: allParsed.json };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new StageError("poll_history", `Timed out waiting for intro video output for prompt ${promptId}.`, 504, lastPayload);
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
      const bytes = Buffer.from(await res.arrayBuffer());
      return bytes;
    }
    lastStatus = res.status;
    lastDetail = await readJsonOrText(res);
    await sleep(VIEW_RETRY_MS);
  }

  throw new StageError(
    "fetch_view",
    `Failed to fetch generated intro video from ComfyUI after ${VIEW_MAX_ATTEMPTS} attempts.`,
    lastStatus,
    lastDetail?.json ?? lastDetail?.text,
  );
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
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          return abs;
        }
      } catch {
        // continue
      }
    }
  }
  return "";
}

async function submitLtxIntroVideo(req: NextRequest, args: {
  imagePath: string;
  positivePrompt: string;
  negativePrompt: string;
  durationSeconds: number;
  titlePrefix: string;
}) {
  const bytes = await fsp.readFile(args.imagePath);
  const fileName = path.basename(args.imagePath) || `character_${Date.now()}.png`;
  const form = new FormData();
  form.append("workflowId", INTRO_VIDEO_WORKFLOW_ID);
  form.append("workflowLabel", "Characters Intro Video LTX 2.3");
  form.append("prompt", args.positivePrompt);
  form.append("positivePrompt", args.positivePrompt);
  form.append("negativePrompt", args.negativePrompt);
  form.append("durationSeconds", String(args.durationSeconds));
  form.append("width", String(INTRO_VIDEO_WIDTH));
  form.append("height", String(INTRO_VIDEO_HEIGHT));
  form.append("title", args.titlePrefix);
  form.append("requestKind", "characters-intro-video");
  form.append("sourceType", "characters");
  form.append("imageA", new Blob([bytes]), fileName);

  const res = await fetch(new URL("/api/comfy", req.nextUrl.origin), {
    method: "POST",
    cache: "no-store",
    headers: {
      cookie: req.headers.get("cookie") || "",
      "x-otg-device-id": req.headers.get("x-otg-device-id") || "web_characters",
    },
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new StageError("submit_prompt", data?.error || `Comfy submit failed (${res.status}).`, res.status, data);
  }
  const promptId = String(data?.prompt_id || data?.promptId || "").trim();
  if (!promptId) {
    throw new StageError("submit_prompt", "Comfy submit did not return a prompt_id.", 502, data);
  }
  return { promptId, data };
}

export async function POST(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    const body = (await req.json().catch(() => ({}))) as Body;

    const imagePath = String(body.imagePath || "").trim();
    const introLine = String(body.introLine || "").trim();
    const likenessDescription = String(body.likenessDescription || "").trim();
    const voiceStyleDefinition = String(body.voiceStyleDefinition || "").trim();
    const characterName = String(body.characterName || "").trim();

    if (!imagePath) {
      return NextResponse.json({ ok: false, error: "imagePath is required" }, { status: 400 });
    }
    if (!likenessDescription) {
      return NextResponse.json({ ok: false, error: "likenessDescription is required" }, { status: 400 });
    }
    if (!voiceStyleDefinition) {
      return NextResponse.json({ ok: false, error: "voiceStyleDefinition is required" }, { status: 400 });
    }
    if (!introLine) {
      return NextResponse.json({ ok: false, error: "introLine is required" }, { status: 400 });
    }
    if (!fs.existsSync(imagePath)) {
      return NextResponse.json({ ok: false, error: "Character image file was not found on disk." }, { status: 400 });
    }

    const durationSeconds = estimateDurationSeconds(introLine);
    const titlePrefix = `characters-intro-${Date.now()}`;
    const positivePrompt = buildPositivePrompt({
      characterName,
      likenessDescription,
      voiceStyleDefinition,
      introLine,
    });

    const { promptId } = await submitLtxIntroVideo(req, {
      imagePath,
      positivePrompt,
      negativePrompt: NEGATIVE_PROMPT,
      durationSeconds,
      titlePrefix,
    });

    const comfyBaseUrl = normalizeBaseUrl(configuredVideoComfyBaseUrl() || "http://127.0.0.1:8188");
    const historyHit = await pollHistoryForVideo(comfyBaseUrl, promptId, titlePrefix);
    const remoteFile = historyHit.file;

    const directOutputPath = resolveExistingComfyOutputPath(remoteFile);
    if (directOutputPath) {
      return NextResponse.json(
        {
          ok: true,
          promptId,
          videoPath: directOutputPath,
          videoUrl: `/api/file?path=${encodeURIComponent(directOutputPath)}`,
          durationSeconds,
          width: INTRO_VIDEO_WIDTH,
          height: INTRO_VIDEO_HEIGHT,
          workflowId: INTRO_VIDEO_WORKFLOW_ID,
          positivePrompt,
          negativePrompt: NEGATIVE_PROMPT,
          remoteFile,
          storage: "comfy-output-direct",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const videoBytes = await fetchViewBinary(comfyBaseUrl, remoteFile);

    const ownerSafe = safeSegment(ownerKey || "local");
    const outputDir = path.join(OTG_DATA_ROOT, "characters", ownerSafe, "intro_videos");
    ensureDir(outputDir);

    const ext = safeVideoExt(remoteFile.filename);
    const localFilename = `${Date.now()}_${basenameOnly(remoteFile.filename).replace(/[^\w.-]+/g, "_") || `intro${ext}`}`;
    const localPath = path.join(outputDir, localFilename);
    await fsp.writeFile(localPath, videoBytes);

    const videoUrl = `/api/file?path=${encodeURIComponent(localPath)}`;

    return NextResponse.json(
      {
        ok: true,
        promptId,
        videoPath: localPath,
        videoUrl,
        durationSeconds,
        width: INTRO_VIDEO_WIDTH,
        height: INTRO_VIDEO_HEIGHT,
        workflowId: INTRO_VIDEO_WORKFLOW_ID,
        positivePrompt,
        negativePrompt: NEGATIVE_PROMPT,
        remoteFile,
        storage: "otg-copy-fallback",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const stage = e instanceof StageError ? e.stage : "characters_intro_video";
    const status = e instanceof StageError && e.status ? e.status : 500;
    const detail = e instanceof StageError ? e.detail : undefined;
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Create intro video failed",
        stage,
        detail,
      },
      { status },
    );
  }
}
