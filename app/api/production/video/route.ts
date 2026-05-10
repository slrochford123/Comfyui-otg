import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";

import { configuredVideoComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type AnyObj = Record<string, any>;
type HistoryFile = { filename: string; subfolder?: string; type?: string; nodeId?: string };

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|flac|ogg|m4a|aac)$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|bmp|gif)$/i;

const POLL_MAX_MS = Math.max(60_000, Number(process.env.OTG_PRODUCTION_VIDEO_MAX_MS || 10 * 60 * 1000));
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.OTG_PRODUCTION_VIDEO_POLL_MS || 1500));
const VIEW_MAX_ATTEMPTS = Math.max(3, Number(process.env.OTG_PRODUCTION_VIDEO_VIEW_MAX_ATTEMPTS || 12));
const VIEW_RETRY_MS = Math.max(750, Number(process.env.OTG_PRODUCTION_VIDEO_VIEW_RETRY_MS || 1250));

const DEFAULT_WORKFLOW_REL = "internal/production/production_ltx23_ia2v_lipsync_api_template.json";
const LEGACY_WORKFLOW_BASENAME = "LTX-2.3 Image Audio 2 Video GGUF 12GB.json";

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

function resolveLocalInput(...candidates: any[]) {
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    if (
      (IMAGE_EXT_RE.test(value) || AUDIO_EXT_RE.test(value) || VIDEO_EXT_RE.test(value)) &&
      fssync.existsSync(value)
    ) {
      return value;
    }
  }
  return "";
}

function comfyInputDirCandidates(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl).toLowerCase();
  const out: string[] = [];
  const envs = [
    process.env.OTG_VIDEO_COMFY_INPUT_DIR,
    process.env.COMFY_INPUT_DIR,
    process.env.COMFYUI_INPUT_DIR,
    process.env.VIDEO_COMFY_INPUT_DIR,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  out.push(...envs);
  out.push(
    "C:\\AI\\Comfyui\\ComfyUI\\input",
    "C:\\AI\\Comfyui\\ComfyUI_windows_portable\\ComfyUI\\input",
    "D:\\AI\\ComfyUI_windows_portable\\ComfyUI\\input",
    "D:\\AI\\Comfyui\\ComfyUI\\input"
  );

  if (normalized.includes("127.0.0.1") || normalized.includes("localhost")) {
    out.push(
      path.join(process.cwd(), "input"),
      path.join(process.cwd(), "ComfyUI", "input"),
      path.join(process.cwd(), "..", "ComfyUI", "input")
    );
  }

  return Array.from(new Set(out.map((p) => path.resolve(p))));
}

async function ensureCopyIntoComfyInput(absPath: string, mediaType: "image" | "audio", baseUrl: string) {
  const base = path.basename(absPath);
  const stem = path.parse(base).name.replace(/[^\w.-]+/g, "_");
  const ext = path.extname(base);
  const filename = `${stem}_${Date.now()}${ext}`;

  for (const dir of comfyInputDirCandidates(baseUrl)) {
    try {
      await ensureDir(dir);
      if (!fssync.existsSync(dir)) continue;
      const target = path.join(dir, filename);
      await fs.copyFile(absPath, target);
      return {
        filename,
        subfolder: "",
        type: "input",
        copiedTo: target,
        fallback: `${mediaType}_copied_to_input`,
      };
    } catch {
      // continue
    }
  }

  throw new StageError(
    "upload_inputs",
    `ComfyUI ${mediaType} upload failed and no writable Comfy input directory fallback was found.`,
    500,
    {
      mediaType,
      attemptedDirs: comfyInputDirCandidates(baseUrl),
      source: absPath,
    }
  );
}

async function uploadBinary(baseUrl: string, absPath: string, mediaType: "image" | "audio") {
  if (!absPath || !fssync.existsSync(absPath)) {
    throw new StageError("upload_inputs", `${mediaType} input not found: ${absPath}`, 400);
  }

  if (mediaType === "audio") {
    return await ensureCopyIntoComfyInput(absPath, "audio", baseUrl);
  }

  const bytes = await fs.readFile(absPath);
  const form = new FormData();
  form.append(mediaType, new Blob([bytes]), path.basename(absPath));
  form.append("type", "input");
  form.append("overwrite", "true");

  const res = await fetchStage(`${baseUrl}/upload/image`, { method: "POST", body: form }, "upload_inputs", 60_000);
  const parsed = await readJsonOrText(res);

  if (!res.ok) {
    if (res.status === 405 || res.status === 404) {
      return await ensureCopyIntoComfyInput(absPath, mediaType, baseUrl);
    }
    throw new StageError(
      "upload_inputs",
      `ComfyUI ${mediaType} upload failed (${res.status}).`,
      res.status,
      parsed.json ?? parsed.text
    );
  }

  const payload: any = parsed.json;
  const name = String(payload?.name || payload?.filename || "").trim();
  if (!name) {
    throw new StageError(
      "upload_inputs",
      `ComfyUI ${mediaType} upload did not return a filename.`,
      502,
      payload ?? parsed.text
    );
  }

  return {
    filename: name,
    subfolder: String(payload?.subfolder || "").trim(),
    type: String(payload?.type || "input").trim() || "input",
  };
}

function normalizeWorkflowFileCandidate(raw: string) {
  return String(raw || "").trim().replace(/\\/g, "/");
}

function resolveWorkflowPath(workflowFileRaw: unknown) {
  const root = process.cwd();
  const workflowsRoot = path.join(root, "comfy_workflows");
  const requested = normalizeWorkflowFileCandidate(String(workflowFileRaw || ""));
  const requestedBase = basenameOnly(requested).toLowerCase();

  const candidates = [
    requested && path.isAbsolute(requested) ? requested : "",
    requested ? path.join(workflowsRoot, requested) : "",
    requested ? path.join(root, requested) : "",
    requestedBase ? path.join(workflowsRoot, "internal", "production", basenameOnly(requested)) : "",
    path.join(workflowsRoot, DEFAULT_WORKFLOW_REL),
  ].filter(Boolean);

  if (requestedBase === LEGACY_WORKFLOW_BASENAME.toLowerCase()) {
    return path.join(workflowsRoot, DEFAULT_WORKFLOW_REL);
  }

  for (const candidate of candidates) {
    if (fssync.existsSync(candidate)) return candidate;
  }

  throw new StageError(
    "workflow_resolve",
    `Workflow not found. Requested="${requested || "<empty>"}". Expected file under comfy_workflows, usually ${DEFAULT_WORKFLOW_REL}.`,
    400,
    { requested, candidates }
  );
}

function setInputIfNodeExists(workflow: AnyObj, nodeId: string, key: string, value: any) {
  const node = workflow?.[nodeId];
  if (!node || typeof node !== "object") return;
  if (!node.inputs || typeof node.inputs !== "object") node.inputs = {};
  node.inputs[key] = value;
}

function normalizeTimelineScenes(raw: any[]) {
  return (Array.isArray(raw) ? raw : [])
    .map((scene, index) => {
      const prompt = String(scene?.prompt || "").trim();
      const durationSec = Math.max(1, Math.min(30, Number(scene?.durationSec || scene?.seconds || 5) || 5));
      const hardCut = scene?.hardCut !== false;
      const title = String(scene?.title || `Scene ${index + 1}`).trim() || `Scene ${index + 1}`;
      const characterNames = Array.isArray(scene?.characterNames)
        ? scene.characterNames.map((name: any) => String(name || "").trim()).filter(Boolean)
        : [];
      return prompt ? { prompt, durationSec, hardCut, title, characterNames } : null;
    })
    .filter(Boolean) as Array<{
      prompt: string;
      durationSec: number;
      hardCut: boolean;
      title: string;
      characterNames: string[];
    }>;
}

function patchPromptRelayTimelineWorkflow(workflow: AnyObj, body: AnyObj) {
  const relayNode = workflow?.["5837"];
  if (!relayNode?.inputs) return false;

  const fps = Math.max(1, Math.min(60, Math.floor(Number(body.timelineFps || body.frameRate || body.fps || 24) || 24)));
  const scenes = normalizeTimelineScenes(body.timelineScenes);
  if (!scenes.length) {
    throw new StageError("workflow_patch", "Prompt Relay timeline requires at least one scene prompt.", 400);
  }

  const segmentLengths = scenes.map((scene) => Math.max(1, Math.round(scene.durationSec * fps)));
  const totalFrames = segmentLengths.reduce((sum, value) => sum + value, 0);
  const totalSeconds = Math.max(1, Math.ceil(totalFrames / fps));
  const globalPrompt = String(body.timelineGlobalPrompt || body.globalPrompt || body.positivePrompt || "").trim();
  const colors = ["#4f8edc", "#e07b3a", "#5cb85c", "#b46cff", "#f0b84f", "#5ec9b8", "#df6f9f", "#8a9cff"];
  const localPrompts = scenes.map((scene, index) => {
    const characterLine = scene.characterNames.length ? `Characters in scene: ${scene.characterNames.join(", ")}.` : "";
    const cutLine =
      scene.hardCut && index > 0
        ? "Hard cut from the previous scene; establish the new shot clearly before continuing the action."
        : "";
    return [characterLine, cutLine, scene.prompt].filter(Boolean).join(" ");
  });

  relayNode.inputs.global_prompt = globalPrompt;
  relayNode.inputs.max_frames = totalFrames;
  relayNode.inputs.timeline_data = JSON.stringify({
    segments: localPrompts.map((prompt, index) => ({
      prompt,
      length: segmentLengths[index],
      color: colors[index % colors.length],
    })),
  });
  relayNode.inputs.local_prompts = localPrompts.join(" | ");
  relayNode.inputs.segment_lengths = segmentLengths.join(", ");
  relayNode.inputs.fps = fps;
  relayNode.inputs.time_units = "frames";

  setInputIfNodeExists(workflow, "616", "value", fps);
  setInputIfNodeExists(workflow, "615", "value", totalSeconds);
  setInputIfNodeExists(workflow, "612", "value", Math.max(512, Math.floor(Number(body.longerEdge || body.width || 1280) || 1280)));
  setInputIfNodeExists(workflow, "608", "image", String(body.imagePathAbs || body.imagePath || ""));
  setInputIfNodeExists(workflow, "5827", "image", String(body.imagePathAbs || body.imagePath || ""));
  setInputIfNodeExists(workflow, "5831", "image", String(body.imagePathAbs || body.imagePath || ""));

  const imageInject = workflow?.["582"];
  if (imageInject?.inputs) {
    imageInject.inputs.num_images = "1";
    imageInject.inputs["num_images.index_1"] = 0;
    imageInject.inputs["num_images.strength_1"] = Number.isFinite(Number(body.startImageStrength))
      ? Math.max(0, Math.min(1, Number(body.startImageStrength)))
      : 1;
  }

  setInputIfNodeExists(workflow, "604", "filename_prefix", String(body.filenamePrefix || "otg_production/prompt_relay"));
  setInputIfNodeExists(workflow, "604", "frame_rate", fps);

  setInputIfNodeExists(workflow, "5756", "strength_model", body.useVideoReasoning ? 1 : 0);
  setInputIfNodeExists(workflow, "622", "strength_model", body.useCrispEnhance ? 0.85 : 0);

  return {
    fps,
    totalFrames,
    totalSeconds,
    segmentLengths,
    sceneCount: scenes.length,
    globalPrompt,
  };
}

function patchWorkflow(workflow: AnyObj, body: AnyObj) {
  const timelineDebug = patchPromptRelayTimelineWorkflow(workflow, body);
  if (timelineDebug) return { timelineDebug };

  const width = Math.max(64, Math.floor(Number(body.width || 1280) || 1280));
  const height = Math.max(64, Math.floor(Number(body.height || 720) || 720));
  const frameRate = Math.max(1, Math.floor(Number(body.frameRate || body.fps || 24) || 24));
  const durationSeconds = Math.max(
    1,
    Math.min(60, Number(body.durationSeconds || body.durationSec || body.duration || 5) || 5)
  );

  setInputIfNodeExists(workflow, "269", "image", String(body.imageFilename || ""));
  setInputIfNodeExists(workflow, "276", "audio", String(body.audioFilename || ""));
  setInputIfNodeExists(workflow, "398", "value", String(body.positivePrompt || ""));
  setInputIfNodeExists(workflow, "375", "text", String(body.negativePrompt || ""));
  setInputIfNodeExists(workflow, "432", "value", Math.max(1, Math.floor(durationSeconds)));
  setInputIfNodeExists(workflow, "433", "value", frameRate);
  setInputIfNodeExists(workflow, "434", "value", width);
  setInputIfNodeExists(workflow, "435", "value", height);

  const node441 = workflow?.["441"];
  if (node441?.inputs) {
    node441.inputs.frame_rate = frameRate;
    node441.inputs.filename_prefix = String(body.filenamePrefix || "Production_LTX23_IA2V_LipSync");
    node441.inputs.save_output = true;
  }

  const node478 = workflow?.["478"];
  if (node478?.inputs) {
    node478.inputs.start_index = Number(node478.inputs.start_index ?? 0);
    node478.inputs.duration = Math.max(1, Math.min(20, Math.floor(durationSeconds)));
  }

  const node477 = workflow?.["477"];
  if (node477?.inputs) {
    node477.inputs.width = width;
    node477.inputs.height = height;
    node477.inputs.upscale_method = String(node477.inputs.upscale_method || "lanczos");
    node477.inputs.keep_proportion = String(node477.inputs.keep_proportion || "crop");
    node477.inputs.crop_position = String(node477.inputs.crop_position || "center");
    node477.inputs.divisible_by = Number(node477.inputs.divisible_by || 64);
  }

  const node382 = workflow?.["382"];
  if (node382?.inputs) {
    node382.inputs.longer_edge = Math.max(width, height, 512);
  }

  const node383 = workflow?.["383"];
  if (node383?.inputs) {
    node383.inputs.img_compression = Number.isFinite(Number(node383.inputs.img_compression))
      ? Number(node383.inputs.img_compression)
      : 18;
  }

  const node378 = workflow?.["378"];
  if (node378?.inputs) {
    node378.inputs.bypass = Boolean(node378.inputs.bypass ?? false);
    node378.inputs.strength = Number.isFinite(Number(node378.inputs.strength))
      ? Number(node378.inputs.strength)
      : 0.7;
  }

  const node365 = workflow?.["365"];
  if (node365?.inputs) {
    node365.inputs.bypass = Boolean(node365.inputs.bypass ?? false);
    node365.inputs.strength = Number.isFinite(Number(node365.inputs.strength))
      ? Number(node365.inputs.strength)
      : 1;
  }

  return {};
}

function workflowRequiresAudioInput(workflow: AnyObj) {
  return Object.values<any>(workflow || {}).some((node) => {
    if (!node || typeof node !== "object") return false;
    const classType = String(node.class_type || node.type || "").toLowerCase();
    const inputs = node.inputs && typeof node.inputs === "object" ? node.inputs : {};
    if (classType.includes("loadaudio") || classType === "load audio") return true;
    return Object.prototype.hasOwnProperty.call(inputs, "audio") && classType.includes("load");
  });
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

function pickVideoHistoryFile(historyJson: any) {
  const all = collectHistoryFiles(historyJson, []);
  return all.find((item) => VIDEO_EXT_RE.test(item.filename)) || null;
}

async function pollHistoryForVideo(baseUrl: string, promptId: string) {
  const started = Date.now();
  let lastPayload: any = null;

  while (Date.now() - started < POLL_MAX_MS) {
    const res = await fetchStage(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, "poll_history", 25_000);
    const parsed = await readJsonOrText(res);

    if (res.ok && parsed.json) {
      lastPayload = parsed.json;
      const direct = pickVideoHistoryFile(parsed.json);
      if (direct) return { file: direct, historyPayload: parsed.json };

      const promptBlock = parsed.json?.[promptId];
      const nested = pickVideoHistoryFile(promptBlock);
      if (nested) return { file: nested, historyPayload: parsed.json };
    }

    const allRes = await fetchStage(`${baseUrl}/history`, { method: "GET" }, "poll_history_all", 25_000);
    const allParsed = await readJsonOrText(allRes);

    if (allRes.ok && allParsed.json) {
      lastPayload = allParsed.json;
      const block = allParsed.json?.[promptId];
      const hit = pickVideoHistoryFile(block);
      if (hit) return { file: hit, historyPayload: allParsed.json };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new StageError("poll_history", `Timed out waiting for video output for prompt ${promptId}.`, 504, lastPayload);
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
    `Failed to fetch rendered video from ComfyUI view endpoint after ${VIEW_MAX_ATTEMPTS} attempts.`,
    lastStatus,
    lastDetail?.json ?? lastDetail?.text
  );
}

async function appendDeviceJob(deviceId: string, promptId: string) {
  try {
    const jobsDir = path.join(OTG_DATA_ROOT, "device_jobs");
    await ensureDir(jobsDir);
    const line = `${JSON.stringify({ ts: new Date().toISOString(), prompt_id: promptId })}\n`;
    await fs.appendFile(path.join(jobsDir, `${deviceId}.jsonl`), line, "utf8");
  } catch {
    // ignore
  }
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const body = (await req.json()) as AnyObj;
    const clientRequestId = String(body.clientRequestId || body.requestId || "").trim();

    const workflowFileRaw = String(body.workflowFile || "").trim();
    const imagePath = String(body.imagePath || body.serverPath || body.generatedImagePath || body.generatedPicturePath || body.picturePath || body.sourceImagePath || "").trim();
    const audioPath = String(body.audioPath || body.serverAudioPath || body.savedAudioPath || body.selectedVoiceAudioPath || body.clipPath || body.voiceClipPath || "").trim();

    if (!workflowFileRaw) {
      return NextResponse.json({ ok: false, error: "workflowFile is required" }, { status: 400 });
    }
    if (!imagePath) {
      return NextResponse.json({ ok: false, error: "imagePath is required" }, { status: 400 });
    }
    const comfyBaseUrl = normalizeBaseUrl(configuredVideoComfyBaseUrl() || "http://127.0.0.1:8188");
    const resolvedWorkflowFile = resolveWorkflowPath(workflowFileRaw);

    const rawWorkflow = await fs.readFile(resolvedWorkflowFile, "utf8");
    const workflow = JSON.parse(rawWorkflow) as AnyObj;
    const requiresAudioInput = workflowRequiresAudioInput(workflow);

    const imageAbs = resolveLocalInput(imagePath);
    if (!imageAbs) {
      throw new StageError("resolve_inputs", "Create Video requires a valid local image path.", 400);
    }

    const audioAbs = audioPath ? resolveLocalInput(audioPath) : "";
    if (requiresAudioInput && !audioAbs) {
      throw new StageError(
        "resolve_inputs",
        "Create Video requires a valid local audio path when custom voice/audio workflow is enabled.",
        400
      );
    }

    const uploadedImage = await uploadBinary(comfyBaseUrl, imageAbs, "image");
    const uploadedAudio = audioAbs ? await uploadBinary(comfyBaseUrl, audioAbs, "audio") : null;

    const productionId = safeSegment(String(body.productionId || "production"));
    const userKey = safeSegment(String(owner.ownerKey || "user"));
    const cardIndex = Math.max(1, Math.min(5, Number(body.cardIndex || body.sceneIndex || 1)));
    const stamp = Date.now();
    const filenamePrefix = `otg_production/${productionId}/card_${cardIndex}_${stamp}`;

    const patchDebug = patchWorkflow(workflow, {
      ...body,
      imageFilename: uploadedImage.filename,
      imagePathAbs: imageAbs,
      audioFilename: uploadedAudio?.filename || "",
      filenamePrefix,
    });

    const submitRes = await fetchStage(
      `${comfyBaseUrl}/prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow }),
      },
      "submit_prompt",
      60_000
    );

    const submitParsed = await readJsonOrText(submitRes);
    if (!submitRes.ok) {
      throw new StageError(
        "submit_prompt",
        `Comfy /prompt failed (${submitRes.status}) @ ${comfyBaseUrl}: ${submitParsed.text || JSON.stringify(submitParsed.json || {})}`,
        submitRes.status,
        submitParsed.json ?? submitParsed.text
      );
    }

    const submitJson: any = submitParsed.json || {};
    const promptId = String(submitJson?.prompt_id || submitJson?.promptId || "").trim();
    if (!promptId) {
      throw new StageError("submit_prompt", "ComfyUI did not return a prompt_id.", 502, submitJson);
    }

    const deviceId = String(req.headers.get("x-otg-device-id") || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 96) || "local";

    await appendDeviceJob(deviceId, promptId);

    const historyHit = await pollHistoryForVideo(comfyBaseUrl, promptId);
    const remoteFile = historyHit.file;
    const bytes = await fetchViewBinary(comfyBaseUrl, remoteFile);

    const ext = safeVideoExt(remoteFile.filename);
    const productionDir = path.join(OTG_DATA_ROOT, "productions", userKey, productionId, "videos");
    await ensureDir(productionDir);

    const localFilename =
      `${Date.now()}_${basenameOnly(remoteFile.filename).replace(/[^\w.-]+/g, "_") || `card_${cardIndex}${ext}`}`;
    const localPath = path.join(productionDir, localFilename);
    await fs.writeFile(localPath, bytes);

    const videoUrl = `/api/file?path=${encodeURIComponent(localPath)}`;

    return NextResponse.json({
      ok: true,
      promptId,
      clientRequestId,
      endpoint: comfyBaseUrl,
      workflowFile: path.relative(process.cwd(), resolvedWorkflowFile).replace(/\\/g, "/"),
      videoPath: localPath,
      videoUrl,
      serverPath: localPath,
      serverUrl: videoUrl,
      generatedVideoPath: localPath,
      generatedVideoUrl: videoUrl,
      remoteFile,
      debug: {
        cardIndex,
        durationSeconds: Math.max(
          1,
          Math.min(60, Number(body.durationSeconds || body.durationSec || body.duration || 5))
        ),
        uploadedImage,
        uploadedAudio,
        requiresAudioInput,
        filenamePrefix,
        ...patchDebug,
      },
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
    }

    const stage = error instanceof StageError ? error.stage : "video_route";
    const status = error instanceof StageError && error.status ? error.status : 500;
    const detail = error instanceof StageError ? error.detail : undefined;

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Create video failed.",
        stage,
        status,
        detail,
      },
      { status: status }
    );
  }
}
