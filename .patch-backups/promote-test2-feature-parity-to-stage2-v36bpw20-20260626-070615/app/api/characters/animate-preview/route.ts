import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { createCharacterAnimationPreviewJob } from "@/lib/jobs/voicePipelineJobs";
import { getOwnerContext } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function firstExistingRoot(...values: Array<string | undefined>) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const resolved = path.resolve(text);
    if (fs.existsSync(resolved)) return resolved;
  }
  return path.resolve(path.join(process.cwd(), "data"));
}

const DATA_ROOT = firstExistingRoot(
  process.env.OTG_DATA_ROOT,
  process.env.OTG_DATA_DIR,
  process.env.DATA_ROOT,
  process.env.DATA_DIR,
  "/var/lib/otg",
  path.join(process.cwd(), "data"),
);

const DATA_ROOT_ALIASES = Array.from(new Set([
  DATA_ROOT,
  path.join(DATA_ROOT, "data"),
  path.join(DATA_ROOT, "uploads"),
  process.env.OTG_DATA_ROOT,
  process.env.OTG_DATA_DIR,
  process.env.DATA_ROOT,
  process.env.DATA_DIR,
  "/var/lib/otg",
  "/var/lib/otg/data",
  "/var/lib/otg/uploads",
  path.join(process.cwd(), "data"),
].filter(Boolean).map((value) => path.resolve(String(value)))));
const COMFY_URL = String(process.env.OTG_VIDEO_COMFY_URL || process.env.COMFYUI_BASE_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
const LTX_WORKFLOW_PATH = path.resolve(
  process.env.ANIMATE_ME_LTX_WORKFLOW_PATH ||
    path.join(process.cwd(), "app", "app", "workflows", "animate-me-create-video-from-images.json"),
);

const INDEX_TTS_ROOT = path.resolve(process.env.INDEX_TTS_ROOT || "C:\\AI\\voices\\IndexTTS2");
const INDEX_TTS_PYTHON = path.resolve(process.env.INDEX_TTS_PYTHON || "C:\\AI\\voices\\IndexTTS2\\.venv\\Scripts\\python.exe");
const INDEX_TTS_BRIDGE = path.resolve(process.env.INDEX_TTS_BRIDGE || "C:\\AI\\voices\\VoiceLab\\scripts\\indextts2_voicelab_smoke.py");

const DEFAULT_DEVICE_ID = "web_characters_builder";
const DEFAULT_SCRIPT = "Hey, thanks for creating me. I'm your new character. Let's make some great movies.";
const COMFY_TIMEOUT_MS = Math.max(60_000, Number(process.env.ANIMATE_ME_COMFY_TIMEOUT_MS || 90 * 60 * 1000));
const INDEX_TTS_TIMEOUT_MS = Math.max(60_000, Number(process.env.ANIMATE_ME_INDEX_TTS_TIMEOUT_MS || 10 * 60 * 1000));
const FFMPEG_TIMEOUT_MS = Math.max(60_000, Number(process.env.ANIMATE_ME_FFMPEG_TIMEOUT_MS || 10 * 60 * 1000));
const ANIMATE_ME_SEED_VC_PYTHON = path.resolve(process.env.SEED_VC_PYTHON || process.env.ANIMATE_ME_SEED_VC_PYTHON || "D:\\AI\\seed-vc\\.venv\\Scripts\\python.exe");
const ANIMATE_ME_SEED_VC_SCRIPT = path.resolve(process.env.SEED_VC_SCRIPT || process.env.ANIMATE_ME_SEED_VC_SCRIPT || path.join(process.cwd(), "scripts", "seedvc", "dub.py"));
const ANIMATE_ME_SEED_VC_URL = String(process.env.SEED_VC_URL || process.env.ANIMATE_ME_SEED_VC_URL || "http://127.0.0.1:7860").trim().replace(/\/+$/, "");
const ANIMATE_ME_SEED_VC_TIMEOUT_MS = Math.max(60_000, Number(process.env.SEED_VC_TIMEOUT_MS || process.env.ANIMATE_ME_SEED_VC_TIMEOUT_MS || 600_000));
const ANIMATE_ME_DECODE_NODE_CLASS = String(process.env.ANIMATE_ME_DECODE_NODE_CLASS || "VAEDecodeTiled");

type JsonRecord = Record<string, any>;

type HistoryFile = {
  filename: string;
  subfolder?: string;
  type?: string;
};

class StageError extends Error {
  stage: string;
  status: number;
  detail: unknown;

  constructor(stage: string, message: string, status = 500, detail: unknown = null) {
    super(message);
    this.stage = stage;
    this.status = status;
    this.detail = detail;
  }
}

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function safeId(value: unknown) {
  return (
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "character"
  );
}

function safeFileStem(value: unknown) {
  return (
    String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "animate_preview"
  );
}

function normalizeDeviceId(value: unknown) {
  return (
    String(value || DEFAULT_DEVICE_ID)
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "") || DEFAULT_DEVICE_ID
  );
}

function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveInsideDataRoot(rawPath: unknown, label: string) {
  const raw = String(rawPath || "").trim();

  if (!raw) {
    throw new StageError("validate_input", `${label} is required.`, 400);
  }

  const normalizedRaw = raw
    .replace(/^data[\\/]/i, "")
    .replace(/^uploads[\\/]/i, "uploads/");

  const resolved = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(DATA_ROOT, normalizedRaw);

  const allowedRoot = DATA_ROOT_ALIASES.find((root) => isInside(root, resolved));
  if (!allowedRoot) {
    throw new StageError("validate_input", `${label} must stay inside an OTG data directory.`, 400, {
      rawPath: raw,
      dataRoot: DATA_ROOT,
      allowedRoots: DATA_ROOT_ALIASES,
    });
  }

  return resolved;
}
function fileExists(absPath: string) {
  try {
    return fs.existsSync(absPath) && fs.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

function requireFile(absPath: string, label: string) {
  if (!fileExists(absPath)) {
    throw new StageError("validate_file", `${label} was not found: ${absPath}`, 400);
  }
}

function dataFileUrl(absPath: string) {
  return `/api/file?path=${encodeURIComponent(absPath)}`;
}

async function readJsonFile(absPath: string): Promise<JsonRecord | null> {
  try {
    return JSON.parse(await fsp.readFile(absPath, "utf8"));
  } catch {
    return null;
  }
}

async function writeJsonFile(absPath: string, value: unknown) {
  await fsp.mkdir(path.dirname(absPath), { recursive: true });
  await fsp.writeFile(absPath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function characterJsonPath(deviceId: string, characterId: string) {
  return path.join(DATA_ROOT, "characters", deviceId, `${characterId}.json`);
}

function voicePackPath(deviceId: string, characterId: string) {
  return path.join(DATA_ROOT, "characters", deviceId, "voice-packs", characterId, "voice-pack.json");
}

function outputDirFor(deviceId: string, characterId: string) {
  return path.join(DATA_ROOT, "characters", deviceId, characterId, "animate-preview");
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }

  return "";
}

function buildLikenessDescription(character: JsonRecord | null, voicePack: JsonRecord | null, body: JsonRecord) {
  return pickString(
    body.likenessDescription,
    character?.globalPromptIdentityBlock,
    character?.identityBlock,
    character?.description,
    voicePack?.identityBlock,
    character?.metadata?.description,
    "Preserve the exact uploaded character identity, outfit, proportions, colors, and silhouette.",
  );
}

function buildVoiceStyleDefinition(character: JsonRecord | null, voicePack: JsonRecord | null, body: JsonRecord) {
  const qwenDesign =
    voicePack?.voiceSettings?.qwenVoiceDesign ||
    voicePack?.indexVoiceReference?.qwenVoiceDesign ||
    character?.voiceSettings?.qwenVoiceDesign ||
    null;

  const explicit = pickString(body.voiceStyleDefinition);
  if (explicit) return explicit;

  return [
    "natural cinematic speaking delivery",
    qwenDesign?.voiceType ? `${qwenDesign.voiceType} voice type` : "",
    qwenDesign?.pitch ? `${qwenDesign.pitch} pitch` : "",
    qwenDesign?.resonance ? `${qwenDesign.resonance} resonance` : "",
    Array.isArray(qwenDesign?.textureTags) ? `${qwenDesign.textureTags.join(", ")} texture` : "",
    qwenDesign?.pace ? `${qwenDesign.pace} pace` : "",
    qwenDesign?.style ? `${qwenDesign.style} style` : "",
    "clear pronunciation",
    "believable character acting",
  ]
    .filter(Boolean)
    .join(", ");
}

function buildIndexEmotion(character: JsonRecord | null, voicePack: JsonRecord | null) {
  const qwenDesign =
    voicePack?.voiceSettings?.qwenVoiceDesign ||
    voicePack?.indexVoiceReference?.qwenVoiceDesign ||
    character?.voiceSettings?.qwenVoiceDesign ||
    null;

  return [
    "natural cinematic delivery",
    "clear pronunciation",
    "believable acting",
    qwenDesign?.voiceType || "",
    qwenDesign?.pitch ? `${qwenDesign.pitch} pitch` : "",
    qwenDesign?.resonance ? `${qwenDesign.resonance} resonance` : "",
    Array.isArray(qwenDesign?.textureTags) ? `${qwenDesign.textureTags.join(", ")} texture` : "",
    qwenDesign?.pace ? `${qwenDesign.pace} pace` : "",
    qwenDesign?.style || "",
  ]
    .filter(Boolean)
    .join(", ");
}

function buildPositivePrompt(args: {
  characterName: string;
  likenessDescription: string;
  voiceStyleDefinition: string;
  introLine: string;
  shot: string;
}) {
  return [
    "Style: cinematic-realistic image-to-video character introduction.",
    `${args.characterName || "The uploaded character"} is standing and looking toward the camera.`,
    args.likenessDescription,
    `The character says in a natural clear voice: "${args.introLine}".`,
    `Voice performance: ${args.voiceStyleDefinition || "natural cinematic speaking delivery"}.`,
    args.shot,
    "The camera slowly pushes in from a full-body view toward the face, ending in a vertical portrait close-up.",
    "Subtle head motion, light breathing, expressive eyes, stable framing, smooth motion continuity, no text overlay, no subtitles, no scene cut, portrait 9:16 framing.",
  ]
    .filter(Boolean)
    .join(" ");
}

const NEGATIVE_PROMPT = [
  "blurry",
  "low quality",
  "still frame",
  "watermark",
  "overlay",
  "titles",
  "subtitles",
  "unrealistic",
  "plastic",
  "fake",
  "out-of-focus",
  "low-detail",
  "extra arms",
  "extra legs",
  "deformed face",
  "warped mouth",
  "bad mouth motion",
  "scene cut",
  "duplicate subject",
].join(", ");

function isTrainedApplioVoiceProfile(value: unknown): value is JsonRecord {
  const profile = value as JsonRecord | null;
  if (!profile || typeof profile !== "object") return false;

  const status = String(profile.status || "").trim();
  const adapter = String(profile.trainingAdapter || profile.adapter || "").trim();
  const modelPath = String(profile.modelPath || "").trim();
  const indexPath = String(profile.indexPath || "").trim();

  return (
    status === "trained" &&
    adapter === "applio_real_training" &&
    Boolean(modelPath) &&
    Boolean(indexPath)
  );
}

function pickCharacterVoiceReferenceWav(character: JsonRecord | null) {
  const profile = character?.characterVoiceProfile as JsonRecord | null;
  return pickString(
    profile?.approvedSamplePath,
    profile?.selectedSamplePath,
    profile?.baseSamplePath,
    profile?.sourceSamplePath,
    profile?.tunedSamplePath,
    profile?.approvedSampleUrl,
    profile?.selectedSampleUrl,
    profile?.baseSampleUrl,
    profile?.sourceSampleUrl,
    profile?.tunedSampleUrl,
  );
}
function pickReferenceWav(voicePack: JsonRecord | null) {
  const raw = pickString(
    voicePack?.referenceWav,
    voicePack?.indexVoiceReference?.audioPath,
    voicePack?.voiceFxPreview?.audioPath,
    voicePack?.voiceFxPreview?.outputPath,
  );

  if (!raw) return "";

  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(DATA_ROOT, raw.replace(/^data[\\/]/i, ""));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function patchAllInputKeys(prompt: JsonRecord, inputKey: string, value: unknown) {
  let count = 0;

  for (const node of Object.values(prompt)) {
    if (!node || typeof node !== "object") continue;

    const inputs = (node as JsonRecord).inputs as JsonRecord | undefined;
    if (!inputs || !Object.prototype.hasOwnProperty.call(inputs, inputKey)) continue;

    inputs[inputKey] = value;
    count += 1;
  }

  return count;
}

function normalizeUploadedWorkflowDecodeNode(prompt: JsonRecord) {
  const node = prompt["662"] as JsonRecord | undefined;

  if (!node || typeof node !== "object") {
    return;
  }

  const classType = String(node.class_type || "");

  if (
    classType !== "LTXVSpatioTemporalTiledVAEDecode" &&
    classType !== "VAEDecodeTiled" &&
    classType !== "VAEDecode"
  ) {
    return;
  }

  if (ANIMATE_ME_DECODE_NODE_CLASS === "VAEDecode") {
    prompt["662"] = {
      inputs: {
        samples: ["320", 0],
        vae: ["825", 0],
      },
      class_type: "VAEDecode",
      _meta: {
        title: "VAE Decode - patched Animate Me replacement",
      },
    };
    return;
  }

  prompt["662"] = {
    inputs: {
      samples: ["320", 0],
      vae: ["825", 0],
      tile_size: 512,
      overlap: 64,
      temporal_size: 64,
      temporal_overlap: 8,
    },
    class_type: "VAEDecodeTiled",
    _meta: {
      title: "VAE Decode Tiled - patched Animate Me replacement",
    },
  };
}
function normalizeUploadedWorkflowNormalizingSampler(prompt: JsonRecord) {
  const node = prompt["675"] as JsonRecord | undefined;

  if (!node || typeof node !== "object") {
    return;
  }

  const classType = String(node.class_type || "");

  if (classType !== "LTXVNormalizingSampler" && classType !== "Any Switch (rgthree)") {
    return;
  }

  prompt["675"] = {
    inputs: {
      any_01: ["112", 0],
    },
    class_type: "Any Switch (rgthree)",
    _meta: {
      title: "Bypass missing LTXVNormalizingSampler - patched Animate Me",
    },
  };

  if (prompt["810"]?.inputs && Object.prototype.hasOwnProperty.call(prompt["810"].inputs, "value")) {
    prompt["810"].inputs.value = false;
  }

  if (prompt["678"]?.inputs) {
    prompt["678"].inputs.on_false = ["112", 0];
    prompt["678"].inputs.on_true = ["675", 0];
  }
}
function patchUploadedWorkflowPromptApi(args: {
  workflow: JsonRecord;
  uploadedImageName: string;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  filenamePrefix: string;
}) {
  const prompt = cloneJson(args.workflow);
  normalizeUploadedWorkflowDecodeNode(prompt);
  normalizeUploadedWorkflowNormalizingSampler(prompt);
  const patchedImageNodeIds: string[] = [];

  for (const [nodeId, node] of Object.entries(prompt)) {
    if (!node || typeof node !== "object") continue;

    const record = node as JsonRecord;
    const classType = String(record.class_type || "");
    const inputs = record.inputs as JsonRecord | undefined;

    if (!inputs || !/LoadImage/i.test(classType) || !Object.prototype.hasOwnProperty.call(inputs, "image")) {
      continue;
    }

    inputs.image = args.uploadedImageName;
    patchedImageNodeIds.push(nodeId);
  }

  if (patchedImageNodeIds.length < 1) {
    throw new StageError("patch_ltx_workflow", "Could not patch uploaded workflow image input. Expected LoadImage nodes with inputs.image.", 500);
  }

  let positivePatched = false;

  if (prompt["767"]?.inputs && Object.prototype.hasOwnProperty.call(prompt["767"].inputs, "value")) {
    prompt["767"].inputs.value = args.positivePrompt;
    positivePatched = true;
  }

  for (const node of Object.values(prompt)) {
    if (!node || typeof node !== "object") continue;

    const record = node as JsonRecord;
    const classType = String(record.class_type || "");
    const title = String(record._meta?.title || "");
    const inputs = record.inputs as JsonRecord | undefined;

    if (
      inputs &&
      /PrimitiveStringMultiline/i.test(classType) &&
      /^Text Prompt$/i.test(title) &&
      Object.prototype.hasOwnProperty.call(inputs, "value")
    ) {
      inputs.value = args.positivePrompt;
      positivePatched = true;
    }
  }

  if (!positivePatched) {
    throw new StageError("patch_ltx_workflow", "Could not patch uploaded workflow positive prompt. Expected node 767 or PrimitiveStringMultiline titled Text Prompt.", 500);
  }

  if (prompt["109"]?.inputs && Object.prototype.hasOwnProperty.call(prompt["109"].inputs, "text")) {
    prompt["109"].inputs.text = args.negativePrompt;
  }

  if (prompt["813"]?.inputs && Object.prototype.hasOwnProperty.call(prompt["813"].inputs, "seed")) {
    prompt["813"].inputs.seed = args.seed;
  }

  if (prompt["818"]?.inputs && Object.prototype.hasOwnProperty.call(prompt["818"].inputs, "seed")) {
    prompt["818"].inputs.seed = args.seed + 17;
  }

  for (const node of Object.values(prompt)) {
    if (!node || typeof node !== "object") continue;

    const inputs = (node as JsonRecord).inputs as JsonRecord | undefined;
    if (!inputs) continue;

    if (Object.prototype.hasOwnProperty.call(inputs, "filename_prefix")) {
      inputs.filename_prefix = args.filenamePrefix;
    }

    if (Object.prototype.hasOwnProperty.call(inputs, "prefix")) {
      inputs.prefix = args.filenamePrefix;
    }
  }

  return {
    prompt,
    patchedImageNodeIds,
  };
}

async function fetchText(url: string, init: RequestInit, timeoutMs: number, stage: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text().catch(() => "");

    if (!response.ok) {
      let detail: unknown = text;
      try {
        detail = text ? JSON.parse(text) : text;
      } catch {
        // keep raw text
      }

      throw new StageError(stage, `${stage} failed with HTTP ${response.status}.`, response.status, detail);
    }

    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadImageToComfy(imagePath: string, filenameStem: string) {
  const bytes = await fsp.readFile(imagePath);
  const ext = path.extname(imagePath) || ".png";
  const uploadName = `${safeFileStem(filenameStem)}${ext}`;

  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const form = new FormData();
  form.append("image", new Blob([arrayBuffer]), uploadName);
  form.append("overwrite", "true");
  form.append("type", "input");

  const text = await fetchText(
    `${COMFY_URL}/upload/image`,
    {
      method: "POST",
      body: form,
    },
    120_000,
    "comfy_upload_image",
  );

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  const name = String(data?.name || uploadName).trim();
  const subfolder = String(data?.subfolder || "").trim();

  return subfolder ? `${subfolder}/${name}` : name;
}

async function submitComfyPrompt(prompt: JsonRecord, clientId: string) {
  const text = await fetchText(
    `${COMFY_URL}/prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        client_id: clientId,
      }),
    },
    120_000,
    "comfy_submit_prompt",
  );

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  const promptId = String(data?.prompt_id || data?.promptId || "").trim();

  if (!promptId) {
    throw new StageError("comfy_submit_prompt", "ComfyUI did not return prompt_id.", 502, data || text);
  }

  return { promptId, data };
}

function collectHistoryFiles(value: unknown, out: HistoryFile[] = []) {
  if (!value || typeof value !== "object") return out;

  if (Array.isArray(value)) {
    for (const item of value) collectHistoryFiles(item, out);
    return out;
  }

  const record = value as Record<string, unknown>;
  const filename = String(record.filename || "").trim();

  if (filename) {
    out.push({
      filename,
      subfolder: String(record.subfolder || "").trim() || undefined,
      type: String(record.type || "").trim() || undefined,
    });
  }

  for (const nested of Object.values(record)) {
    collectHistoryFiles(nested, out);
  }

  return out;
}

function pickVideoFile(historyPayload: any, expectedPrefix: string) {
  const all = collectHistoryFiles(historyPayload).filter((file) => /\.(mp4|webm|mov|m4v)$/i.test(file.filename));

  if (!all.length) return null;

  return (
    all
      .slice()
      .sort((a, b) => {
        const aScore = a.filename.includes(expectedPrefix) ? 10 : 0;
        const bScore = b.filename.includes(expectedPrefix) ? 10 : 0;
        return bScore - aScore;
      })[0] || null
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollComfyForVideo(promptId: string, expectedPrefix: string) {
  const started = Date.now();
  let lastPayload: any = null;

  while (Date.now() - started < COMFY_TIMEOUT_MS) {
    const text = await fetchText(`${COMFY_URL}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, 30_000, "comfy_poll_history");

    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }

    if (data) {
      lastPayload = data;
      const hit = pickVideoFile(data, expectedPrefix);
      if (hit) {
        return {
          file: hit,
          historyPayload: data,
        };
      }
    }

    await sleep(3000);
  }

  throw new StageError("comfy_poll_history", `Timed out waiting for ComfyUI video output for prompt ${promptId}.`, 504, lastPayload);
}

async function fetchComfyViewFile(file: HistoryFile) {
  const params = new URLSearchParams();
  params.set("filename", file.filename);
  if (file.subfolder) params.set("subfolder", file.subfolder);
  if (file.type) params.set("type", file.type);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(`${COMFY_URL}/view?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new StageError("comfy_fetch_video", `Failed to fetch ComfyUI output file with HTTP ${response.status}.`, response.status, file);
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function generateUploadedWorkflowVideo(args: {
  imagePath: string;
  positivePrompt: string;
  negativePrompt: string;
  outDir: string;
  filenamePrefix: string;
}) {
  requireFile(LTX_WORKFLOW_PATH, "Animate Me uploaded workflow");

  const workflow = await readJsonFile(LTX_WORKFLOW_PATH);

  if (!workflow || Array.isArray((workflow as any).nodes)) {
    throw new StageError("load_ltx_workflow", `Expected Prompt API workflow JSON at ${LTX_WORKFLOW_PATH}.`, 500);
  }

  const uploadedImageName = await uploadImageToComfy(args.imagePath, args.filenamePrefix);
  const seed = Math.floor(1_000_000 + Math.random() * 8_999_999);

  const { prompt, patchedImageNodeIds } = patchUploadedWorkflowPromptApi({
    workflow,
    uploadedImageName,
    positivePrompt: args.positivePrompt,
    negativePrompt: args.negativePrompt,
    seed,
    filenamePrefix: args.filenamePrefix,
  });

  const clientId = `animate-me-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const submit = await submitComfyPrompt(prompt, clientId);
  const historyHit = await pollComfyForVideo(submit.promptId, args.filenamePrefix);
  const videoBytes = await fetchComfyViewFile(historyHit.file);

  await fsp.mkdir(args.outDir, { recursive: true });

  const ext = path.extname(historyHit.file.filename) || ".mp4";
  const rawVideoPath = path.join(args.outDir, `${args.filenamePrefix}_raw${ext}`);
  await fsp.writeFile(rawVideoPath, videoBytes);

  return {
    videoPath: rawVideoPath,
    videoUrl: dataFileUrl(rawVideoPath),
    promptId: submit.promptId,
    seed,
    workflowPath: LTX_WORKFLOW_PATH,
    uploadedImageName,
    patchedImageNodeIds,
    remoteFile: historyHit.file,
  };
}

function runLoggedProcess(args: {
  command: string;
  commandArgs: string[];
  cwd?: string;
  timeoutMs: number;
  stdoutPath: string;
  stderrPath: string;
  stage: string;
  env?: NodeJS.ProcessEnv;
}) {
  return new Promise<void>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(args.command, args.commandArgs, {
      cwd: args.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: args.env || process.env,
    });

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }

      reject(new StageError(args.stage, `${args.stage} timed out.`, 504));
    }, args.timeoutMs);

    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new StageError(args.stage, error.message, 500));
    });

    child.on("exit", async (code) => {
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      await fsp.mkdir(path.dirname(args.stdoutPath), { recursive: true });
      await fsp.writeFile(args.stdoutPath, stdout, "utf8").catch(() => undefined);
      await fsp.writeFile(args.stderrPath, stderr, "utf8").catch(() => undefined);

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new StageError(args.stage, `${args.stage} failed with exit code ${code}.`, 500, {
          stdout: stdout.slice(-4000),
          stderr: stderr.slice(-4000),
          command: args.command,
          commandArgs: args.commandArgs,
        }),
      );
    });
  });
}

async function extractVideoAudioForSeedVc(args: {
  rawVideoPath: string;
  sourceAudioPath: string;
  logsDir: string;
}) {
  await fsp.mkdir(path.dirname(args.sourceAudioPath), { recursive: true });
  await fsp.mkdir(args.logsDir, { recursive: true });

  const stdoutPath = path.join(args.logsDir, "ffmpeg_extract_seedvc_source_stdout.log");
  const stderrPath = path.join(args.logsDir, "ffmpeg_extract_seedvc_source_stderr.log");

  await runLoggedProcess({
    command: process.env.FFMPEG_PATH || "ffmpeg",
    commandArgs: [
      "-y",
      "-i",
      args.rawVideoPath,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "44100",
      "-ac",
      "1",
      args.sourceAudioPath,
    ],
    timeoutMs: FFMPEG_TIMEOUT_MS,
    stdoutPath,
    stderrPath,
    stage: "ffmpeg_extract_seedvc_source",
  });

  const stat = await fsp.stat(args.sourceAudioPath).catch(() => null);

  if (!stat?.isFile() || stat.size <= 0) {
    throw new StageError("ffmpeg_extract_seedvc_source", "ffmpeg completed but did not create a valid Seed-VC source WAV.", 500, {
      rawVideoPath: args.rawVideoPath,
      sourceAudioPath: args.sourceAudioPath,
      stdoutPath,
      stderrPath,
    });
  }

  return {
    audioPath: args.sourceAudioPath,
    audioUrl: dataFileUrl(args.sourceAudioPath),
    outputBytes: stat.size,
    stdoutPath,
    stderrPath,
  };
}

async function runSeedVcForAnimatePreview(args: {
  sourceAudioPath: string;
  referenceWav: string;
  outputWav: string;
  logsDir: string;
}) {
  requireFile(ANIMATE_ME_SEED_VC_PYTHON, "Seed-VC Python");
  requireFile(ANIMATE_ME_SEED_VC_SCRIPT, "Seed-VC bridge script");
  requireFile(args.sourceAudioPath, "Seed-VC source performance audio");
  requireFile(args.referenceWav, "Seed-VC reference WAV");

  await fsp.mkdir(path.dirname(args.outputWav), { recursive: true });
  await fsp.mkdir(args.logsDir, { recursive: true });

  const stdoutPath = path.join(args.logsDir, "seedvc_stdout.log");
  const stderrPath = path.join(args.logsDir, "seedvc_stderr.log");

  await runLoggedProcess({
    command: ANIMATE_ME_SEED_VC_PYTHON,
    commandArgs: [
      ANIMATE_ME_SEED_VC_SCRIPT,
      "--server-url",
      ANIMATE_ME_SEED_VC_URL,
      "--source",
      args.sourceAudioPath,
      "--reference",
      args.referenceWav,
      "--out",
      args.outputWav,
      "--steps",
      String(process.env.ANIMATE_ME_SEED_VC_STEPS || process.env.SEEDVC_DIFFUSION_STEPS || "30"),
      "--length-adjust",
      String(process.env.ANIMATE_ME_SEED_VC_LENGTH_ADJUST || process.env.SEEDVC_LENGTH_ADJUST || "1"),
      "--intelligibility",
      String(process.env.ANIMATE_ME_SEED_VC_INTELLIGIBILITY || "0"),
      "--similarity",
      String(process.env.ANIMATE_ME_SEED_VC_SIMILARITY || process.env.SEEDVC_CFG_RATE || "0.7"),
      "--top-p",
      String(process.env.ANIMATE_ME_SEED_VC_TOP_P || "0.9"),
      "--temperature",
      String(process.env.ANIMATE_ME_SEED_VC_TEMPERATURE || "1.0"),
      "--repetition-penalty",
      String(process.env.ANIMATE_ME_SEED_VC_REPETITION_PENALTY || "1.0"),
      "--convert-style",
    ],
    cwd: process.cwd(),
    timeoutMs: ANIMATE_ME_SEED_VC_TIMEOUT_MS,
    stdoutPath,
    stderrPath,
    stage: "seed_vc",
  });

  const stat = await fsp.stat(args.outputWav).catch(() => null);

  if (!stat?.isFile() || stat.size <= 0) {
    throw new StageError("seed_vc", "Seed-VC completed but did not create a valid output WAV.", 500, {
      sourceAudioPath: args.sourceAudioPath,
      referenceWav: args.referenceWav,
      outputWav: args.outputWav,
      stdoutPath,
      stderrPath,
      seedVcUrl: ANIMATE_ME_SEED_VC_URL,
      scriptPath: ANIMATE_ME_SEED_VC_SCRIPT,
    });
  }

  return {
    audioPath: args.outputWav,
    audioUrl: dataFileUrl(args.outputWav),
    outputBytes: stat.size,
    stdoutPath,
    stderrPath,
    seedVcUrl: ANIMATE_ME_SEED_VC_URL,
    scriptPath: ANIMATE_ME_SEED_VC_SCRIPT,
  };
}
async function runIndexTtsForAnimatePreview(args: {
  text: string;
  referenceWav: string;
  outputWav: string;
  logsDir: string;
  emotion: string;
}) {
  requireFile(INDEX_TTS_PYTHON, "IndexTTS2 Python");
  requireFile(INDEX_TTS_BRIDGE, "IndexTTS2 bridge");
  requireFile(args.referenceWav, "Selected Index voice reference WAV");

  await fsp.mkdir(args.logsDir, { recursive: true });

  const paramsPath = path.join(args.logsDir, "animate_me_index_params.json");
  const stdoutPath = path.join(args.logsDir, "animate_me_index_stdout.log");
  const stderrPath = path.join(args.logsDir, "animate_me_index_stderr.log");

  await writeJsonFile(paramsPath, {
    index_tts_root: INDEX_TTS_ROOT,
    reference_wav: args.referenceWav,
    output_wav: args.outputWav,
    text: args.text,
    emotion: args.emotion,
    emotion_alpha: 0.58,
  });

  await runLoggedProcess({
    command: INDEX_TTS_PYTHON,
    commandArgs: [INDEX_TTS_BRIDGE, "--params-json", paramsPath, "--stdout-log", stdoutPath, "--stderr-log", stderrPath],
    cwd: INDEX_TTS_ROOT,
    timeoutMs: INDEX_TTS_TIMEOUT_MS,
    stdoutPath,
    stderrPath,
    stage: "index_tts",
  });

  const stat = await fsp.stat(args.outputWav).catch(() => null);

  if (!stat?.isFile() || stat.size <= 0) {
    throw new StageError("index_tts", "IndexTTS2 completed but did not create a valid output WAV.", 500, {
      outputWav: args.outputWav,
      paramsPath,
      stdoutPath,
      stderrPath,
    });
  }

  return {
    audioPath: args.outputWav,
    audioUrl: dataFileUrl(args.outputWav),
    outputBytes: stat.size,
    paramsPath,
    stdoutPath,
    stderrPath,
  };
}

async function muxFinalVideo(args: {
  rawVideoPath: string;
  audioPath: string;
  finalVideoPath: string;
  logsDir: string;
}) {
  await fsp.mkdir(path.dirname(args.finalVideoPath), { recursive: true });
  await fsp.mkdir(args.logsDir, { recursive: true });

  const stdoutPath = path.join(args.logsDir, "ffmpeg_mux_stdout.log");
  const stderrPath = path.join(args.logsDir, "ffmpeg_mux_stderr.log");

  await runLoggedProcess({
    command: process.env.FFMPEG_PATH || "ffmpeg",
    commandArgs: [
      "-y",
      "-i",
      args.rawVideoPath,
      "-i",
      args.audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      args.finalVideoPath,
    ],
    timeoutMs: FFMPEG_TIMEOUT_MS,
    stdoutPath,
    stderrPath,
    stage: "ffmpeg_mux",
  });

  const stat = await fsp.stat(args.finalVideoPath).catch(() => null);

  if (!stat?.isFile() || stat.size <= 0) {
    throw new StageError("ffmpeg_mux", "ffmpeg completed but did not create a valid final MP4.", 500, {
      finalVideoPath: args.finalVideoPath,
      stdoutPath,
      stderrPath,
    });
  }

  return {
    videoPath: args.finalVideoPath,
    videoUrl: dataFileUrl(args.finalVideoPath),
    outputBytes: stat.size,
    stdoutPath,
    stderrPath,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as JsonRecord;
    const owner = await getOwnerContext(req);

    const deviceId = normalizeDeviceId(body.deviceId || req.headers.get("x-otg-device-id") || DEFAULT_DEVICE_ID);
    const characterId = safeId(body.characterId || body.name || body.characterName || "character");
    const character = await readJsonFile(characterJsonPath(deviceId, characterId));
    const voicePack = await readJsonFile(voicePackPath(deviceId, characterId));

    const imageCandidate = pickString(body.imagePath, character?.imagePath, character?.previewImagePath, character?.fullBodyImagePath);
    const imagePath = resolveInsideDataRoot(imageCandidate, "imagePath");
    requireFile(imagePath, "Character source image");

    const trainedApplioProfileReady = isTrainedApplioVoiceProfile(character?.characterVoiceProfile || null);

    if (!voicePack && !trainedApplioProfileReady) {
      throw new StageError("voice_pack", `Voice pack was not found for ${characterId}. Create or regenerate the character voice pack first.`, 400, {
        expectedPath: voicePackPath(deviceId, characterId),
      });
    }

    const referenceWav = pickString(
      pickReferenceWav(voicePack),
      trainedApplioProfileReady ? pickCharacterVoiceReferenceWav(character) : "",
    );

    if (!referenceWav) {
      throw new StageError("voice_pack", `Voice pack for ${characterId} does not contain a selected reference WAV and no trained profile reference WAV was available.`, 400, {
        expectedPath: voicePackPath(deviceId, characterId),
        trainedApplioProfileReady,
      });
    }

    const resolvedReferenceWav = referenceWav.startsWith("/api/")
      ? resolveInsideDataRoot(new URL(referenceWav, "http://local").searchParams.get("file") || referenceWav, "referenceWav")
      : resolveInsideDataRoot(referenceWav, "referenceWav");

    requireFile(resolvedReferenceWav, "Voice reference WAV");

    const introLine = pickString(body.script, body.introLine, DEFAULT_SCRIPT);
    const shot = pickString(
      body.shot,
      "full-body character standing, vertical portrait framing, camera slowly pushes in to a close-up of the character face",
    );
    const characterName = pickString(body.characterName, character?.name, voicePack?.characterName, characterId);
    const likenessDescription = buildLikenessDescription(character, voicePack, body);
    const voiceStyleDefinition = buildVoiceStyleDefinition(character, voicePack, body);

    const outDir = outputDirFor(deviceId, characterId);
    const logsDir = path.join(outDir, "logs");
    await fsp.mkdir(logsDir, { recursive: true });

    const timestamp = Date.now();
    const stem = safeFileStem(`animate_me_${characterId}_${timestamp}`);

    const positivePrompt = buildPositivePrompt({
      characterName,
      likenessDescription,
      voiceStyleDefinition,
      introLine,
      shot,
    });

    const sourceAudioPath = path.join(outDir, `${stem}_source_audio.wav`);
    const seedVcAudioPath = path.join(outDir, `${stem}_seedvc.wav`);
    const finalVideoPath = path.join(outDir, `${stem}_final.mp4`);

    const jobResult = createCharacterAnimationPreviewJob(owner.ownerKey, {
      action: "animate_preview",
      characterId,
      characterName,
      deviceId,
      imagePath,
      referenceWav: resolvedReferenceWav,
      introLine,
      shot,
      likenessDescription,
      voiceStyleDefinition,
      positivePrompt,
      negativePrompt: NEGATIVE_PROMPT,
      output: {
        outDir,
        logsDir,
        sourceAudioPath,
        seedVcAudioPath,
        finalVideoPath,
        filenamePrefix: stem,
      },
      workflow: {
        workflowPath: LTX_WORKFLOW_PATH,
        comfyUrl: COMFY_URL,
      },
      seedVc: {
        seedVcUrl: ANIMATE_ME_SEED_VC_URL,
        scriptPath: ANIMATE_ME_SEED_VC_SCRIPT,
      },
    });

    if (!jobResult.ok) {
      return json(jobResult.status, {
        ok: false,
        stage: "queue_animate_preview",
        error: jobResult.error,
      });
    }

    return json(202, {
      ok: true,
      status: "queued",
      jobId: jobResult.job.jobId,
      job: jobResult.job,
      message: "Animation preview queued for the Windows worker.",
      characterId,
      characterName,
      engine: "Animate Me uploaded image-video workflow plus Seed-VC voice conversion",
      pipeline: {
        video: "queued Windows worker ComfyUI /prompt using app/app/workflows/animate-me-create-video-from-images.json",
        audio: "queued Windows worker Seed-VC converts generated video speech using selected voice-pack reference WAV",
        mux: "queued Windows worker ffmpeg video plus Seed-VC converted audio",
      },
    });
  } catch (error: any) {
    const status = error instanceof StageError ? error.status : 500;
    const stage = error instanceof StageError ? error.stage : "animate_preview";

    return json(status, {
      ok: false,
      stage,
      error: error?.message || "Animate Me failed.",
      detail: error instanceof StageError ? error.detail : undefined,
    });
  }
}
