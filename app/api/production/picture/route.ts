import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";

import { configuredImageComfyBaseUrl, logComfyRouting } from "@/app/api/_lib/comfyTarget";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";

// OTG v36bm3 production picture hardening START
// TEST-only guard: fresh ComfyUI seeds, fixed 1280x720 output dimensions, and anti-clone prompts.
const OTG_PRODUCTION_PICTURE_WIDTH_V36BM3 = 1280;
const OTG_PRODUCTION_PICTURE_HEIGHT_V36BM3 = 720;
const OTG_MAX_COMFY_SEED_V36BM3 = 2147483646;
let otgProductionPictureSeedCounterV36BM3 = 0;

const OTG_PRODUCTION_PICTURE_ANTI_DUPLICATE_GUARD_V36BM3 = [
  "OTG anti-duplicate guard:",
  "render each selected/named character exactly once unless the user explicitly requests multiples.",
  "Do not create clones, twins, duplicate bodies, duplicate faces, repeated silhouettes, mirrored copies, crowd copies, background copies, extra heads, extra limbs, or repeated versions of the same character.",
  "Keep one coherent unique identity per selected character and preserve character separation."
].join(" ");

const OTG_PRODUCTION_PICTURE_NEGATIVE_DUPLICATE_GUARD_V36BM3 = [
  "duplicate character",
  "clone",
  "cloned person",
  "twin copy",
  "repeated face",
  "repeated body",
  "duplicate body",
  "duplicate face",
  "mirrored duplicate",
  "extra duplicate person",
  "extra head",
  "extra limbs",
  "background duplicate"
].join(", ");

function createOtgFreshComfySeedV36BM3(): number {
  otgProductionPictureSeedCounterV36BM3 = (otgProductionPictureSeedCounterV36BM3 + 1) % 9973;
  const entropy = Math.floor(Math.random() * OTG_MAX_COMFY_SEED_V36BM3);
  const mixed = entropy + Date.now() + otgProductionPictureSeedCounterV36BM3;
  return (mixed % OTG_MAX_COMFY_SEED_V36BM3) + 1;
}

function setOtgDimensionValueV36BM3(record: Record<string, unknown>, key: string, value: number): void {
  const current = record[key];
  if (typeof current === "number" && Number.isFinite(current)) {
    record[key] = value;
    return;
  }
  if (typeof current === "string" && /^\d+$/.test(current.trim())) {
    record[key] = String(value);
  }
}

function appendOtgPositiveGuardV36BM3(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("OTG anti-duplicate guard:")) {
    return value;
  }
  return `${trimmed}\n\n${OTG_PRODUCTION_PICTURE_ANTI_DUPLICATE_GUARD_V36BM3}`.trim();
}

function appendOtgNegativeGuardV36BM3(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("duplicate character") && trimmed.includes("clone")) {
    return value;
  }
  return `${trimmed}${trimmed ? ", " : ""}${OTG_PRODUCTION_PICTURE_NEGATIVE_DUPLICATE_GUARD_V36BM3}`;
}

function hardenOtgProductionPictureWorkflowV36BM3<T>(workflow: T): T {
  const seen = new WeakSet<object>();
  const seedKeys = new Set(["seed", "noise_seed", "random_seed"]);
  const positiveTextKeys = new Set(["prompt", "text", "positive", "positive_prompt"]);
  const negativeTextKeys = new Set(["negative", "negative_prompt"]);

  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") {
      return;
    }

    if (seen.has(value as object)) {
      return;
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    const inputs = record.inputs && typeof record.inputs === "object" && !Array.isArray(record.inputs)
      ? record.inputs as Record<string, unknown>
      : undefined;

    const targets = inputs ? [record, inputs] : [record];
    for (const target of targets) {
      for (const key of Object.keys(target)) {
        const lowerKey = key.toLowerCase();
        const current = target[key];

        if (seedKeys.has(lowerKey)) {
          target[key] = createOtgFreshComfySeedV36BM3();
          continue;
        }

        if (lowerKey === "width" || lowerKey === "w") {
          setOtgDimensionValueV36BM3(target, key, OTG_PRODUCTION_PICTURE_WIDTH_V36BM3);
          continue;
        }

        if (lowerKey === "height" || lowerKey === "h") {
          setOtgDimensionValueV36BM3(target, key, OTG_PRODUCTION_PICTURE_HEIGHT_V36BM3);
          continue;
        }

        if (typeof current === "string" && positiveTextKeys.has(lowerKey)) {
          target[key] = appendOtgPositiveGuardV36BM3(current);
          continue;
        }

        if (typeof current === "string" && negativeTextKeys.has(lowerKey)) {
          target[key] = appendOtgNegativeGuardV36BM3(current);
        }
      }
    }

    for (const child of Object.values(record)) {
      visit(child);
    }
  };

  visit(workflow);
  return workflow;
}
// OTG v36bm3 production picture hardening END

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type HistoryFile = { filename: string; subfolder?: string; type?: string; nodeId?: string };

type ProductionPictureRequest = {
  storyboardCount?: number;
  productionId?: string;
  productionName?: string;
  workflowFile?: string;
  backgroundPrompt?: string;
  characterDescriptors?: string[];
  characterImages?: string[];
  defaultIdentity?: string;
  defaultLens?: string;
  defaultMood?: string;
  defaultStyle?: string;
  negativePrompt?: string;
  positivePrompt?: string;
  usePreviousIdentityLock?: boolean;
  usePreviousLength?: boolean;
  usePreviousStyleLock?: boolean;
};

type ObjectInfoMap = Record<string, any>;

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const POLL_MAX_MS = Math.max(60_000, Number(process.env.OTG_PRODUCTION_PICTURE_MAX_MS || 7 * 60 * 1000));
const POLL_INTERVAL_MS = Math.max(750, Number(process.env.OTG_PRODUCTION_PICTURE_POLL_MS || 1_500));
const VIEW_RETRY_MS = Math.max(500, Number(process.env.OTG_PRODUCTION_PICTURE_VIEW_RETRY_MS || 1_250));
const VIEW_MAX_ATTEMPTS = Math.max(2, Number(process.env.OTG_PRODUCTION_PICTURE_VIEW_MAX_ATTEMPTS || 10));
const JOBS_DIR = path.join(OTG_DATA_ROOT, "device_jobs");

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

function safeDeviceId(raw: string | null | undefined) {
  const value = String(raw || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return value || "local";
}

function safeExt(filename: string) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  return IMAGE_EXT_RE.test(ext) ? ext : ".png";
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

function workflowPathCandidates(workflowFile: string) {
  const requested = String(workflowFile || "").trim();
  const fallback = "storyboard/StoryBoard 1.json";
  const relative = requested || fallback;
  const roots = [
    process.env.OTG_WORKFLOWS_ROOT,
    process.env.COMFY_WORKFLOWS_DIR,
    process.env.COMFY_WORKFLOWS_ROOT,
    path.join(process.cwd(), "comfy_workflows"),
  ].filter(Boolean) as string[];

  const candidates: string[] = [];
  for (const root of roots) {
    candidates.push(path.join(root, relative));
    if (/storyboard\s*1\.json$/i.test(relative)) {
      candidates.push(path.join(root, "storyboard", "StoryBoard 1.json"));
    }
  }
  return Array.from(new Set(candidates));
}

function resolveWorkflowPath(workflowFile: string) {
  const candidates = workflowPathCandidates(workflowFile);
  const found = candidates.find((candidate) => fssync.existsSync(candidate));
  if (!found) throw new StageError("workflow_resolve", `Workflow template not found. Checked: ${candidates.join(" | ")}`, 500);
  return found;
}

async function uploadImageToComfy(baseUrl: string, absPath: string) {
  if (!fssync.existsSync(absPath)) {
    throw new StageError("upload_inputs", `Input image not found: ${absPath}`, 400);
  }
  const bytes = await fs.readFile(absPath);
  const form = new FormData();
  form.append("image", new Blob([bytes]), path.basename(absPath));
  form.append("type", "input");
  form.append("overwrite", "true");

  const res = await fetchStage(`${baseUrl}/upload/image`, { method: "POST", body: form }, "upload_inputs", 60_000);
  const parsed = await readJsonOrText(res);
  if (!res.ok) {
    throw new StageError("upload_inputs", `ComfyUI upload failed (${res.status}).`, res.status, parsed.json ?? parsed.text);
  }
  const payload: any = parsed.json;
  const name = String(payload?.name || payload?.filename || "").trim();
  if (!name) {
    throw new StageError("upload_inputs", "ComfyUI upload did not return a filename.", 502, payload ?? parsed.text);
  }
  return {
    filename: name,
    subfolder: String(payload?.subfolder || "").trim(),
    type: String(payload?.type || "input").trim() || "input",
  };
}

function buildCompiledPrompt(body: ProductionPictureRequest, descriptors: string[]) {
  const chunks = [
    body.positivePrompt,
    body.backgroundPrompt,
    body.defaultLens ? `Lens: ${body.defaultLens}` : "",
    body.defaultMood ? `Mood: ${body.defaultMood}` : "",
    body.defaultStyle ? `Style: ${body.defaultStyle}` : "",
    body.defaultIdentity ? `Identity lock: ${body.defaultIdentity}` : "",
    descriptors.length ? `Character references: ${descriptors.join(" | ")}` : "",
    body.usePreviousIdentityLock ? "Carry forward previous identity continuity." : "",
    body.usePreviousStyleLock ? "Carry forward previous style continuity." : "",
    body.usePreviousLength ? "Match the previous card length and framing continuity where possible." : "",
  ];
  return chunks
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function findPromptLineNodeId(workflow: Record<string, any>) {
  for (const [nodeId, node] of Object.entries(workflow || {})) {
    const ct = String(node?.class_type || "").toLowerCase();
    const title = String(node?._meta?.title || node?._meta?.name || "").toLowerCase();
    if (ct.includes("promptline") || title.includes("promptline")) return nodeId;
  }
  return null;
}

function isPromptRef(value: any, promptLineId: string) {
  return Array.isArray(value) && String(value[0] || "") === promptLineId;
}

function stripPromptLineDependency(workflow: Record<string, any>, promptText: string) {
  const promptLineId = findPromptLineNodeId(workflow);
  if (!promptLineId) return { promptLineId: null as string | null, patchedNodeIds: [] as string[] };

  const patchedNodeIds: string[] = [];
  for (const [nodeId, node] of Object.entries<any>(workflow || {})) {
    if (!node?.inputs || typeof node.inputs !== "object") continue;
    for (const [inputKey, inputValue] of Object.entries<any>(node.inputs)) {
      if (isPromptRef(inputValue, promptLineId)) {
        node.inputs[inputKey] = promptText;
        if (!patchedNodeIds.includes(nodeId)) patchedNodeIds.push(nodeId);
      }
    }
  }

  delete workflow[promptLineId];
  return { promptLineId, patchedNodeIds };
}

function findPositiveEncoderNodeIds(workflow: Record<string, any>) {
  const out: string[] = [];
  for (const [nodeId, node] of Object.entries<any>(workflow || {})) {
    const classType = String(node?.class_type || "");
    if (!classType.startsWith("TextEncodeQwenImageEditPlus")) continue;
    const title = String(node?._meta?.title || node?._meta?.name || "").toLowerCase();
    if (title.includes("positive") || title.includes("posative") || title.includes("pos")) out.push(nodeId);
  }
  if (out.length) return out;
  for (const [nodeId, node] of Object.entries<any>(workflow || {})) {
    const classType = String(node?.class_type || "");
    if (!classType.startsWith("TextEncodeQwenImageEditPlus")) continue;
    if (typeof node?.inputs?.prompt === "string") out.push(nodeId);
  }
  return out;
}

async function fetchObjectInfo(baseUrl: string): Promise<ObjectInfoMap | null> {
  try {
    const res = await fetchStage(`${baseUrl}/object_info`, { method: "GET" }, "object_info", 20_000);
    const parsed = await readJsonOrText(res);
    if (!res.ok || !parsed.json || typeof parsed.json !== "object") return null;
    return parsed.json as ObjectInfoMap;
  } catch {
    return null;
  }
}

function extractInputOptions(objectInfo: ObjectInfoMap | null, classType: string, inputName: string): string[] {
  const nodeInfo: any = objectInfo?.[classType];
  const raw = nodeInfo?.input?.required?.[inputName]?.[0] ?? nodeInfo?.input?.optional?.[inputName]?.[0] ?? null;
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v || "").trim()).filter(Boolean);
}

function slashVariants(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return [];
  const set = new Set<string>();
  set.add(value);
  set.add(value.replace(/\\/g, "/"));
  set.add(value.replace(/\//g, "\\"));
  const base = path.posix.basename(value.replace(/\\/g, "/"));
  if (base) {
    set.add(base);
    set.add(`Qwen/${base}`);
    set.add(`Qwen\\${base}`);
    set.add(`zit/${base}`);
    set.add(`zit\\${base}`);
  }
  return Array.from(set).filter(Boolean);
}

function pickMatchingOption(options: string[], desired: string, extraCandidates: string[] = []) {
  const cleaned = options.map((opt) => String(opt || "").trim()).filter(Boolean);
  if (!cleaned.length) return null;

  const candidates = Array.from(new Set([...slashVariants(desired), ...extraCandidates.flatMap((v) => slashVariants(v))]));
  const lowered = new Map(cleaned.map((opt) => [opt.toLowerCase(), opt]));

  for (const candidate of candidates) {
    const hit = lowered.get(candidate.toLowerCase());
    if (hit) return hit;
  }

  const desiredBase = path.posix.basename(String(desired || "").replace(/\\/g, "/")).toLowerCase();
  if (desiredBase) {
    const baseMatch = cleaned.find((opt) => path.posix.basename(opt.replace(/\\/g, "/")).toLowerCase() === desiredBase);
    if (baseMatch) return baseMatch;
  }

  for (const candidate of candidates) {
    const c = candidate.toLowerCase();
    const contains = cleaned.find((opt) => opt.toLowerCase().includes(c));
    if (contains) return contains;
  }
  return null;
}

function reconcileKnownModelRefs(workflow: Record<string, any>, objectInfo: ObjectInfoMap | null) {
  const changed: Array<{ nodeId: string; field: string; from: string; to: string }> = [];
  const debug: Record<string, any> = {};

  const unetOptions = extractInputOptions(objectInfo, "UNETLoader", "unet_name");
  const loraOptions = extractInputOptions(objectInfo, "LoraLoaderModelOnly", "lora_name");
  debug.unetOptionCount = unetOptions.length;
  debug.loraOptionCount = loraOptions.length;

  for (const [nodeId, node] of Object.entries<any>(workflow || {})) {
    if (node?.class_type === "UNETLoader" && typeof node?.inputs?.unet_name === "string") {
      const raw = String(node.inputs.unet_name).trim();
      const chosen = pickMatchingOption(unetOptions, raw, [
        raw.replace(/2511_fp8mixed/i, "2511_bf16"),
        raw.replace(/2511_bf16/i, "2511_fp8mixed"),
        raw.replace(/2511_/i, "2509_"),
        raw.replace(/2509_/i, "2511_"),
      ]);
      if (chosen && chosen !== raw) {
        node.inputs.unet_name = chosen;
        changed.push({ nodeId, field: "unet_name", from: raw, to: chosen });
      }
    }

    if (node?.class_type === "LoraLoaderModelOnly" && typeof node?.inputs?.lora_name === "string") {
      const raw = String(node.inputs.lora_name).trim();
      const base = path.posix.basename(raw.replace(/\\/g, "/"));
      const chosen = pickMatchingOption(loraOptions, raw, [base, `zit/${base}`, `zit\\${base}`]);
      if (chosen && chosen !== raw) {
        node.inputs.lora_name = chosen;
        changed.push({ nodeId, field: "lora_name", from: raw, to: chosen });
      }
    }
  }

  return { changed, debug };
}

function findSaveImageNodeId(workflow: Record<string, any>) {
  for (const [nodeId, node] of Object.entries(workflow || {})) {
    if (node?.class_type === "SaveImage") return nodeId;
  }
  return null;
}

const OTG_PRODUCTION_PICTURE_WIDTH_V36BM = 1280;
const OTG_PRODUCTION_PICTURE_HEIGHT_V36BM = 720;
const OTG_PRODUCTION_PICTURE_POSITIVE_GUARD_V36BM =
  "Composition rule: render exactly one visible instance of each selected character. Do not clone, duplicate, mirror, repeat, multiply, or create extra copies of any character. If one character is selected, show that character once only.";
const OTG_PRODUCTION_PICTURE_NEGATIVE_GUARD_V36BM =
  "duplicate character, cloned character, clone, twin, twins, duplicate person, repeated person, repeated face, extra body, extra copy of character, multiple copies of the same character, mirrored duplicate character, duplicated subject";

function randomProductionPictureSeedV36BM() {
  // OTG_PRODUCTION_PICTURE_SEED_SIZE_DUPLICATE_FIX_V36BM
  return Math.floor(1_000_000_000_000 + Math.random() * 8_000_000_000_000_000);
}

function appendOnceV36BM(value: string, addition: string) {
  const text = String(value || "").trim();
  if (!text) return addition;
  if (text.toLowerCase().includes(addition.toLowerCase().slice(0, 60))) return text;
  return `${text}\n${addition}`;
}

function looksLikeNegativePromptNodeV36BM(node: any) {
  const classType = String(node?.class_type || "").toLowerCase();
  const title = String(node?._meta?.title || "").toLowerCase();
  return classType.includes("negative") || title.includes("negative");
}

function stringLooksLikePromptTextV36BM(value: string, promptText: string) {
  const text = String(value || "").trim();
  const prompt = String(promptText || "").trim();
  if (!text || !prompt) return false;
  if (text === prompt) return true;
  const probe = prompt.slice(0, Math.min(80, prompt.length));
  return probe.length >= 24 && text.includes(probe);
}

function enforceProductionPictureSeedSizePromptV36BM(
  workflow: Record<string, any>,
  promptText: string
) {
  let seedChanges = 0;
  let sizeChanges = 0;
  let positiveGuardChanges = 0;
  let negativeGuardChanges = 0;

  for (const node of Object.values(workflow || {}) as any[]) {
    const inputs = node?.inputs;
    if (!inputs || typeof inputs !== "object") continue;

    const isNegativeNode = looksLikeNegativePromptNodeV36BM(node);

    for (const key of Object.keys(inputs)) {
      const lowerKey = key.toLowerCase();
      const value = inputs[key];

      if (
        lowerKey === "seed" ||
        lowerKey === "noise_seed" ||
        lowerKey === "random_seed" ||
        lowerKey.endsWith("_seed")
      ) {
        if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
          inputs[key] = randomProductionPictureSeedV36BM();
          seedChanges += 1;
        }
        continue;
      }

      if (
        (lowerKey === "width" || lowerKey.endsWith("_width") || lowerKey === "image_width") &&
        (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)))
      ) {
        inputs[key] = OTG_PRODUCTION_PICTURE_WIDTH_V36BM;
        sizeChanges += 1;
        continue;
      }

      if (
        (lowerKey === "height" || lowerKey.endsWith("_height") || lowerKey === "image_height") &&
        (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)))
      ) {
        inputs[key] = OTG_PRODUCTION_PICTURE_HEIGHT_V36BM;
        sizeChanges += 1;
        continue;
      }

      if (typeof value === "string" && (lowerKey === "prompt" || lowerKey === "text" || lowerKey === "value")) {
        if (isNegativeNode) {
          inputs[key] = appendOnceV36BM(value, OTG_PRODUCTION_PICTURE_NEGATIVE_GUARD_V36BM);
          negativeGuardChanges += 1;
        } else if (stringLooksLikePromptTextV36BM(value, promptText)) {
          inputs[key] = appendOnceV36BM(value, OTG_PRODUCTION_PICTURE_POSITIVE_GUARD_V36BM);
          positiveGuardChanges += 1;
        }
      }
    }
  }

  return {
    marker: "OTG_PRODUCTION_PICTURE_SEED_SIZE_DUPLICATE_FIX_V36BM",
    width: OTG_PRODUCTION_PICTURE_WIDTH_V36BM,
    height: OTG_PRODUCTION_PICTURE_HEIGHT_V36BM,
    seedChanges,
    sizeChanges,
    positiveGuardChanges,
    negativeGuardChanges,
  };
}
function sortedLoadImageNodeIds(workflow: Record<string, any>) {
  return Object.keys(workflow || {})
    .filter((nodeId) => workflow?.[nodeId]?.class_type === "LoadImage")
    .sort((a, b) => Number(a) - Number(b));
}

function patchWorkflow(
  workflow: Record<string, any>,
  body: ProductionPictureRequest,
  uploadedImages: Array<{ filename: string; subfolder?: string; type?: string }>,
  objectInfo: ObjectInfoMap | null
) {
  const promptText = buildCompiledPrompt(body, (body.characterDescriptors || []).filter(Boolean));
  if (!promptText) {
    throw new StageError("patch_workflow", "Missing positive/background prompt content for Production picture.", 400);
  }

  const promptLinePatch = stripPromptLineDependency(workflow, promptText);
  if (!promptLinePatch.patchedNodeIds.length) {
    const positiveNodeIds = findPositiveEncoderNodeIds(workflow);
    for (const nodeId of positiveNodeIds) {
      if (workflow[nodeId]?.inputs) workflow[nodeId].inputs.prompt = promptText;
    }
    if (!positiveNodeIds.length) {
      throw new StageError("patch_workflow", "Could not find a positive prompt encoder in the storyboard workflow.", 500);
    }
  }

  const loadNodes = sortedLoadImageNodeIds(workflow);
  if (loadNodes.length < uploadedImages.length) {
    throw new StageError("patch_workflow", `Workflow has only ${loadNodes.length} LoadImage nodes, but ${uploadedImages.length} character images were provided.`, 500);
  }
  for (let index = 0; index < uploadedImages.length; index += 1) {
    const targetNodeId = loadNodes[index];
    const uploadedImage = uploadedImages[index];
    if (!uploadedImage) {
      throw new StageError("patch_workflow", `Missing uploaded image for LoadImage node ${index + 1}.`, 500);
    }
    workflow[targetNodeId].inputs.image = uploadedImage.subfolder
      ? `${uploadedImage.subfolder.replace(/^\/+|\/+$/g, "")}/${uploadedImage.filename}`
      : uploadedImage.filename;
  }

  const modelRefPatch = reconcileKnownModelRefs(workflow, objectInfo);

  const saveNodeId = findSaveImageNodeId(workflow);
  if (saveNodeId && workflow?.[saveNodeId]?.inputs) {
    const productionId = safeSegment(body.productionId || body.productionName || "production");
    workflow[saveNodeId].inputs.filename_prefix = `otg_production/${productionId}/card_${Date.now()}`;
  }

  return {
    promptText,
    promptLineId: promptLinePatch.promptLineId,
    promptPatchedNodes: promptLinePatch.patchedNodeIds,
    loadNodes,
    saveNodeId,
    modelRefChanges: modelRefPatch.changed,
    modelInventory: modelRefPatch.debug,
  };
}

function extractImageFilesFromHistory(record: any): HistoryFile[] {
  const files: HistoryFile[] = [];
  const seen = new Set<string>();

  const visit = (value: any, nodeId?: string) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, nodeId);
      return;
    }
    if (!value || typeof value !== "object") return;

    if (value.filename && IMAGE_EXT_RE.test(String(value.filename))) {
      const file: HistoryFile = {
        filename: String(value.filename),
        subfolder: value.subfolder ? String(value.subfolder) : "",
        type: value.type ? String(value.type) : "output",
        nodeId,
      };
      const key = `${file.type}|${file.subfolder}|${file.filename}`;
      if (!seen.has(key)) {
        seen.add(key);
        files.push(file);
      }
    }

    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      visit(nestedValue, nodeId ?? nestedKey);
    }
  };

  if (record?.outputs && typeof record.outputs === "object") {
    for (const [nodeId, output] of Object.entries(record.outputs)) {
      visit(output, nodeId);
    }
  } else {
    visit(record);
  }

  return files;
}

async function fetchHistoryRecord(baseUrl: string, promptId: string) {
  const direct = await fetchStage(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { method: "GET" }, "poll_history", 20_000);
  const directParsed = await readJsonOrText(direct);
  if (direct.ok) {
    const directJson: any = directParsed.json;
    const directRecord = directJson?.[promptId] ?? directJson;
    if (directRecord && typeof directRecord === "object" && Object.keys(directRecord).length) {
      return { record: directRecord, source: "direct", raw: directJson };
    }
  }

  const fallback = await fetchStage(`${baseUrl}/history`, { method: "GET" }, "poll_history_all", 20_000);
  const fallbackParsed = await readJsonOrText(fallback);
  if (!fallback.ok) {
    throw new StageError("poll_history_all", `Comfy history failed (${fallback.status}).`, fallback.status, fallbackParsed.json ?? fallbackParsed.text);
  }
  const fallbackJson: any = fallbackParsed.json;
  const fallbackRecord = fallbackJson?.[promptId] ?? null;
  return { record: fallbackRecord, source: "all", raw: fallbackJson };
}

function chooseBestHistoryFile(files: HistoryFile[], expectedPrefix: string) {
  const byPrefix = files.find((file) => `${file.subfolder || ""}/${file.filename}`.includes(expectedPrefix) || file.filename.includes(path.basename(expectedPrefix)));
  if (byPrefix) return byPrefix;
  return files[0] || null;
}

async function fetchViewBytes(baseUrl: string, file: HistoryFile) {
  const query = new URLSearchParams();
  query.set("filename", file.filename);
  query.set("type", file.type || "output");
  query.set("subfolder", file.subfolder || "");

  let lastFailure: any = null;
  for (let attempt = 1; attempt <= VIEW_MAX_ATTEMPTS; attempt += 1) {
    const res = await fetchStage(`${baseUrl}/view?${query.toString()}`, { method: "GET" }, "fetch_view", 60_000);
    if (res.ok) {
      return Buffer.from(await res.arrayBuffer());
    }
    const parsed = await readJsonOrText(res);
    lastFailure = { status: res.status, detail: parsed.json ?? parsed.text, attempt };
    if (res.status !== 404 || attempt === VIEW_MAX_ATTEMPTS) break;
    await sleep(VIEW_RETRY_MS);
  }
  throw new StageError("fetch_view", `Comfy /view failed for ${file.filename}.`, lastFailure?.status || 502, lastFailure);
}

function buildOutputDir(ownerKey: string, productionId: string) {
  const dir = path.join(OTG_DATA_ROOT, "productions", safeSegment(ownerKey), safeSegment(productionId || "production"), "pictures");
  ensureDir(dir);
  return dir;
}

function appendJobLog(entry: Record<string, any>, deviceId: string) {
  try {
    ensureDir(JOBS_DIR);
    const file = path.join(JOBS_DIR, `${deviceId}.jsonl`);
    fssync.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // best effort only
  }
}

async function resolveProductionPictureInputImagePathV36AY(input: unknown): Promise<string> {
  // OTG_PRODUCTION_PICTURE_INPUT_RESOLVER_V36AY
  // Resolve saved background/character workflow images before ComfyUI upload.
  // Supports absolute paths, bare ComfyUI filenames, /api/file?path=..., and /api/comfy-image?filename=...
  const fsV36AY = await import("fs");
  const pathV36AY = await import("path");

  const rawInput = String(input || "").trim();

  if (!rawInput) {
    throw new Error("Input image path is empty.");
  }

  function decodeV36AY(value: string) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function isFileV36AY(value: string) {
    try {
      return fsV36AY.existsSync(value) && fsV36AY.statSync(value).isFile();
    } catch {
      return false;
    }
  }

  function extractCandidateV36AY(value: string) {
    const trimmed = decodeV36AY(value.trim()).replace(/^file:\/+/i, "");

    try {
      const url = new URL(trimmed, "http://otg.local");

      if (url.pathname.endsWith("/api/file")) {
        return decodeV36AY(url.searchParams.get("path") || url.searchParams.get("filename") || trimmed);
      }

      if (url.pathname.endsWith("/api/comfy-image")) {
        return decodeV36AY(url.searchParams.get("path") || url.searchParams.get("filename") || trimmed);
      }
    } catch {
      // Fall through.
    }

    return trimmed.split("#")[0].split("?")[0];
  }

  async function findByBasenameV36AY(root: string, fileName: string, maxDepth = 5) {
    if (!root || !fileName) return "";

    const normalizedRoot = pathV36AY.resolve(root);

    try {
      if (!fsV36AY.existsSync(normalizedRoot) || !fsV36AY.statSync(normalizedRoot).isDirectory()) {
        return "";
      }
    } catch {
      return "";
    }

    const skipDirs = new Set([
      ".git",
      ".next",
      "node_modules",
      ".patch-backups",
      "dist",
      "build",
      ".turbo",
    ]);

    const queue: Array<{ dir: string; depth: number }> = [{ dir: normalizedRoot, depth: 0 }];

    while (queue.length) {
      const item = queue.shift();
      if (!item) break;

      let entries: any[] = [];

      try {
        entries = await fsV36AY.promises.readdir(item.dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = pathV36AY.join(item.dir, entry.name);

        if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
          return fullPath;
        }

        if (entry.isDirectory() && item.depth < maxDepth && !skipDirs.has(entry.name)) {
          queue.push({ dir: fullPath, depth: item.depth + 1 });
        }
      }
    }

    return "";
  }

  const candidate = extractCandidateV36AY(rawInput);
  const fileName = pathV36AY.basename(candidate);

  const roots = [
    process.cwd(),
    pathV36AY.join(process.cwd(), "data"),
    pathV36AY.join(process.cwd(), "data", "backgrounds"),
    pathV36AY.join(process.cwd(), "data", "background_studio"),
    pathV36AY.join(process.cwd(), "data", "production_backgrounds"),
    pathV36AY.join(process.cwd(), "data", "production_storyboard_sync"),
    pathV36AY.join(process.cwd(), "public"),
    process.env.COMFYUI_OUTPUT_DIR || "",
    process.env.COMFY_OUTPUT_DIR || "",
    process.env.OTG_COMFY_OUTPUT_DIR || "",
    process.env.COMFYUI_INPUT_DIR || "",
    "E:\\Renders\\ComfyUI",
    "E:\\Renders\\ComfyUI\\output",
    "E:\\ComfyUI\\output",
    "C:\\AI\\ComfyUI\\output",
    "C:\\AI\\ComfyUI_windows_portable\\ComfyUI\\output",
  ].filter(Boolean);

  const directCandidates = new Set<string>();

  if (pathV36AY.isAbsolute(candidate)) {
    directCandidates.add(candidate);
  } else {
    directCandidates.add(pathV36AY.resolve(process.cwd(), candidate));
    for (const root of roots) {
      directCandidates.add(pathV36AY.resolve(root, candidate));
      directCandidates.add(pathV36AY.resolve(root, fileName));
    }
  }

  for (const possiblePath of directCandidates) {
    if (isFileV36AY(possiblePath)) {
      return possiblePath;
    }
  }

  for (const root of roots) {
    const found = await findByBasenameV36AY(root, fileName, 5);
    if (found && isFileV36AY(found)) {
      return found;
    }
  }

  throw new Error(`Input image not found after resolver search: ${rawInput}`);
}


type TemporarySceneAssetV36BN2 = {
  fieldPath: string;
  name: string;
  kind: "prop_or_object" | "vehicle" | "symbol_or_emblem" | "weapon_or_tool" | "one_shot_character" | "background_element" | "style_reference";
  sourceHint: string;
};

const TEMPORARY_SCENE_ASSET_PROMPT_MARKER_V36BN2 = "OTG_TEMP_SCENE_ASSET_RULES_V36BN2";
const TEMPORARY_SCENE_ASSET_NEGATIVE_MARKER_V36BN2 = "OTG_TEMP_SCENE_ASSET_NEGATIVE_RULES_V36BN2";

async function readTemporarySceneAssetSourceV36BN2(request: { clone: () => Request }): Promise<unknown> {
  try {
    return await request.clone().json();
  } catch {
    try {
      return await request.clone().formData();
    } catch {
      return undefined;
    }
  }
}

function isFormDataLikeV36BN2(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

function isFileLikeImageV36BN2(value: unknown): boolean {
  if (typeof File !== "undefined" && value instanceof File) {
    const name = value.name || "uploaded-image";
    const type = value.type || "";
    return type.toLowerCase().startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name);
  }

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    const type = value.type || "";
    return type.toLowerCase().startsWith("image/");
  }

  return false;
}

function isLikelyImageReferenceStringV36BN2(value: string): boolean {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) return false;
  if (lower.startsWith("data:image/")) return true;
  if (/\.(png|jpe?g|webp|gif|bmp)(\?|#|$)/i.test(lower)) return true;
  if (lower.includes("/uploads/") && /(image|png|jpg|jpeg|webp|gif|bmp)/i.test(lower)) return true;
  if (lower.includes("base64") && lower.includes("image")) return true;

  return false;
}

function isLikelyDirectSceneAssetPathV36BN2(path: string): boolean {
  const lower = path.toLowerCase();

  if (/(selectedcharacters|selected_characters|charactercard|character_card|characters\.|characters\[|characterimage|character_image)/i.test(lower)) {
    return false;
  }

  return /(input|upload|uploaded|reference|refimage|ref_image|initimage|init_image|image|sceneasset|scene_asset|asset|prop|misc|storyboard|direct)/i.test(lower);
}

function inferTemporarySceneAssetKindV36BN2(path: string): TemporarySceneAssetV36BN2["kind"] {
  const lower = path.toLowerCase();

  if (/(logo|emblem|symbol|badge|crest|seal|coin|mark)/i.test(lower)) return "symbol_or_emblem";
  if (/(gun|rifle|pistol|sword|knife|blade|weapon|tool|staff|wand)/i.test(lower)) return "weapon_or_tool";
  if (/(car|truck|vehicle|ship|boat|aircraft|plane|motorcycle|bike)/i.test(lower)) return "vehicle";
  if (/(oneshot|one_shot|extra|npc|person|face|body|creature|animal)/i.test(lower)) return "one_shot_character";
  if (/(background|location|environment|room|set)/i.test(lower)) return "background_element";
  if (/(style|mood|look|palette|aesthetic)/i.test(lower)) return "style_reference";

  return "prop_or_object";
}

function assetDisplayNameFromPathV36BN2(path: string, fallbackIndex: number): string {
  const cleaned = path
    .replace(/\[[0-9]+\]/g, "")
    .split(/[.]/g)
    .filter(Boolean)
    .slice(-2)
    .join(" ")
    .replace(/[_-]+/g, " ")
    .trim();

  return cleaned || `temporary scene asset ${fallbackIndex}`;
}

function extractTemporarySceneAssetsV36BN2(source: unknown): TemporarySceneAssetV36BN2[] {
  const assets: TemporarySceneAssetV36BN2[] = [];
  const seenObjects = new WeakSet<object>();
  const seenPaths = new Set<string>();

  const addAsset = (fieldPath: string, sourceHint: string) => {
    if (!isLikelyDirectSceneAssetPathV36BN2(fieldPath)) return;
    if (seenPaths.has(fieldPath)) return;

    seenPaths.add(fieldPath);
    assets.push({
      fieldPath,
      name: assetDisplayNameFromPathV36BN2(fieldPath, assets.length + 1),
      kind: inferTemporarySceneAssetKindV36BN2(fieldPath),
      sourceHint,
    });
  };

  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > 8 || value == null || assets.length >= 12) return;

    if (typeof value === "string") {
      if (isLikelyImageReferenceStringV36BN2(value)) {
        addAsset(path || "directInputImage", "image-reference-string");
      }
      return;
    }

    if (isFileLikeImageV36BN2(value)) {
      addAsset(path || "directInputImage", "uploaded-image-file");
      return;
    }

    if (isFormDataLikeV36BN2(value)) {
      for (const [key, entry] of value.entries()) {
        visit(entry, path ? `${path}.${key}` : key, depth + 1);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      return;
    }

    if (typeof value === "object") {
      if (seenObjects.has(value)) return;
      seenObjects.add(value);

      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        visit(entry, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  };

  visit(source, "", 0);
  return assets;
}

function buildTemporarySceneAssetPositiveGuardV36BN2(assets: TemporarySceneAssetV36BN2[]): string {
  const assetSummary = assets
    .map((asset, index) => `${index + 1}. ${asset.name} (${asset.kind}) from ${asset.fieldPath}`)
    .join("; ");

  return [
    `[${TEMPORARY_SCENE_ASSET_PROMPT_MARKER_V36BN2}]`,
    "Temporary Scene Asset rules for direct uploaded input/reference images:",
    "Treat each direct uploaded input/reference image as one deliberate scene asset, not as style noise, not as a repeatable pattern, and not as a request for multiple copies.",
    "Render each temporary scene asset exactly once unless the storyboard prompt explicitly asks for more than one.",
    "Preserve the asset's core silhouette, markings, material, color, and visible identity.",
    "Do not clone, mirror, tile, scatter, repeat, duplicate, or create extra variants of the uploaded asset.",
    assetSummary ? `Detected temporary scene assets: ${assetSummary}.` : "Detected temporary scene assets: direct uploaded input/reference image.",
  ].join(" ");
}

function buildTemporarySceneAssetNegativeGuardV36BN2(assets: TemporarySceneAssetV36BN2[]): string {
  const names = assets.map((asset) => asset.name).join(", ");

  return [
    `[${TEMPORARY_SCENE_ASSET_NEGATIVE_MARKER_V36BN2}]`,
    "duplicate uploaded asset, repeated uploaded asset, cloned input image subject, mirrored copy of reference asset, tiled emblem, repeated logo, repeated symbol, extra copy of prop, extra copy of weapon, extra copy of vehicle, duplicate one-shot character, twin copy, cloned person, copied silhouette, repeated object, scattered copies, multiple variants of the same uploaded image",
    names ? `duplicate copies of: ${names}` : "duplicate copies of direct uploaded input/reference image",
  ].join(" ");
}

function isPromptLikeFieldV36BN2(key: string, path: string): boolean {
  const lower = `${path}.${key}`.toLowerCase();
  return /(prompt|positive|negative|caption|conditioning|clip_l|clip_g|text)/i.test(lower);
}

function isNegativePromptLikeFieldV36BN2(key: string, path: string): boolean {
  const lower = `${path}.${key}`.toLowerCase();
  return /(negative|neg_prompt|negative_prompt|uncond|uc)/i.test(lower);
}

function applyTemporarySceneAssetPromptGuardsV36BN2(workflow: unknown, assets: TemporarySceneAssetV36BN2[]): void {
  if (!Array.isArray(assets) || assets.length < 1 || workflow == null) return;

  const positiveGuard = buildTemporarySceneAssetPositiveGuardV36BN2(assets);
  const negativeGuard = buildTemporarySceneAssetNegativeGuardV36BN2(assets);
  const seenObjects = new WeakSet<object>();

  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > 16 || value == null) return;

    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      return;
    }

    if (typeof value !== "object") return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);

    const record = value as Record<string, unknown>;

    for (const [key, entry] of Object.entries(record)) {
      const childPath = path ? `${path}.${key}` : key;

      if (typeof entry === "string" && isPromptLikeFieldV36BN2(key, path)) {
        const guard = isNegativePromptLikeFieldV36BN2(key, path) ? negativeGuard : positiveGuard;
        const marker = isNegativePromptLikeFieldV36BN2(key, path)
          ? TEMPORARY_SCENE_ASSET_NEGATIVE_MARKER_V36BN2
          : TEMPORARY_SCENE_ASSET_PROMPT_MARKER_V36BN2;

        if (!entry.includes(marker)) {
          record[key] = `${entry.trimEnd()}\n\n${guard}`;
        }
      } else {
        visit(entry, childPath, depth + 1);
      }
    }
  };

  visit(workflow, "workflow", 0);
}// OTG V36BO1: Qwen native next-scene workflow adapter.
const OTG_QWEN_NEXT_SCENE_BASE_WORKFLOW_V36BO1_BASE64 = "ewogICIxIjogewogICAgImlucHV0cyI6IHsKICAgICAgInByb21wdCI6ICJOZXh0IFNjZW5lOnRoZSB0d28gY2hhcmFjdGVyIGh1ZyBvdXRzaWRlIGluIGZyb250IG9mIHRoZSBkb29yIiwKICAgICAgImNsaXAiOiBbCiAgICAgICAgIjMzIiwKICAgICAgICAwCiAgICAgIF0sCiAgICAgICJ2YWUiOiBbCiAgICAgICAgIjEwIiwKICAgICAgICAwCiAgICAgIF0sCiAgICAgICJpbWFnZTEiOiBbCiAgICAgICAgIjExIiwKICAgICAgICAwCiAgICAgIF0sCiAgICAgICJpbWFnZTIiOiBbCiAgICAgICAgIjE2NyIsCiAgICAgICAgMAogICAgICBdLAogICAgICAiaW1hZ2UzIjogWwogICAgICAgICIxNjgiLAogICAgICAgIDAKICAgICAgXQogICAgfSwKICAgICJjbGFzc190eXBlIjogIlRleHRFbmNvZGVRd2VuSW1hZ2VFZGl0UGx1cyIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJUZXh0RW5jb2RlUXdlbkltYWdlRWRpdFBsdXMgKFBvc2l0aXZlIFByb21wdCkiCiAgICB9CiAgfSwKICAiMTAiOiB7CiAgICAiaW5wdXRzIjogewogICAgICAidmFlX25hbWUiOiAicXdlbl9pbWFnZV92YWUuc2FmZXRlbnNvcnMiCiAgICB9LAogICAgImNsYXNzX3R5cGUiOiAiVkFFTG9hZGVyIiwKICAgICJfbWV0YSI6IHsKICAgICAgInRpdGxlIjogIkxvYWQgVkFFIgogICAgfQogIH0sCiAgIjExIjogewogICAgImlucHV0cyI6IHsKICAgICAgImltYWdlIjogIkNoYXJhY3RlciBDYXJkXzAwMDA4Xy53ZWJwIgogICAgfSwKICAgICJjbGFzc190eXBlIjogIkxvYWRJbWFnZSIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJMb2FkIEltYWdlIDEiCiAgICB9CiAgfSwKICAiMTMiOiB7CiAgICAiaW5wdXRzIjogewogICAgICAic2FtcGxlcyI6IFsKICAgICAgICAiOTkiLAogICAgICAgIDAKICAgICAgXSwKICAgICAgInZhZSI6IFsKICAgICAgICAiMTAiLAogICAgICAgIDAKICAgICAgXQogICAgfSwKICAgICJjbGFzc190eXBlIjogIlZBRURlY29kZSIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJWQUUgRGVjb2RlIgogICAgfQogIH0sCiAgIjE0IjogewogICAgImlucHV0cyI6IHsKICAgICAgImZpbGVuYW1lX3ByZWZpeCI6ICJDb21meVVJIiwKICAgICAgImltYWdlcyI6IFsKICAgICAgICAiMTMiLAogICAgICAgIDAKICAgICAgXQogICAgfSwKICAgICJjbGFzc190eXBlIjogIlNhdmVJbWFnZSIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJTYXZlIEltYWdlIgogICAgfQogIH0sCiAgIjMwIjogewogICAgImlucHV0cyI6IHsKICAgICAgInNoaWZ0IjogMywKICAgICAgIm1vZGVsIjogWwogICAgICAgICIxNjAiLAogICAgICAgIDAKICAgICAgXQogICAgfSwKICAgICJjbGFzc190eXBlIjogIk1vZGVsU2FtcGxpbmdBdXJhRmxvdyIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJNb2RlbFNhbXBsaW5nQXVyYUZsb3ciCiAgICB9CiAgfSwKICAiMzIiOiB7CiAgICAiaW5wdXRzIjogewogICAgICAidW5ldF9uYW1lIjogInF3ZW5faW1hZ2VfZWRpdF8yNTA5X2ZwOF9lNG0zZm4uc2FmZXRlbnNvcnMiLAogICAgICAid2VpZ2h0X2R0eXBlIjogImRlZmF1bHQiCiAgICB9LAogICAgImNsYXNzX3R5cGUiOiAiVU5FVExvYWRlciIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJMb2FkIERpZmZ1c2lvbiBNb2RlbCIKICAgIH0KICB9LAogICIzMyI6IHsKICAgICJpbnB1dHMiOiB7CiAgICAgICJjbGlwX25hbWUiOiAicXdlbl8yLjVfdmxfN2JfZnA4X3NjYWxlZC5zYWZldGVuc29ycyIsCiAgICAgICJ0eXBlIjogInF3ZW5faW1hZ2UiLAogICAgICAiZGV2aWNlIjogImRlZmF1bHQiCiAgICB9LAogICAgImNsYXNzX3R5cGUiOiAiQ0xJUExvYWRlciIsCiAgICAiX21ldGEiOiB7CiAgICAgICJ0aXRsZSI6ICJMb2FkIENMSVAiCiAgICB9CiAgfSwKICAiMzkiOiB7CiAgICAiaW5wdXRzIjogewogICAgICAicHJvbXB0IjogIiIsCiAgICAgICJjbGlwIjogWwogICAgICAgICIzMyIsCiAgICAgICAgMAogICAgICBdLAogICAgICAidmFlIjogWwogICAgICAgICIxMCIsCiAgICAgICAgMAogICAgICBdLAogICAgICAiaW1hZ2UxIjogWwogICAgICAgICIxMSIsCiAgICAgICAgMAogICAgICBdCiAgICB9LAogICAgImNsYXNzX3R5cGUiOiAiVGV4dEVuY29kZVF3ZW5JbWFnZUVkaXRQbHVzIiwKICAgICJfbWV0YSI6IHsKICAgICAgInRpdGxlIjogIlRleHRFbmNvZGVRd2VuSW1hZ2VFZGl0UGx1cyAoTmVnYXRpdmUgUHJvbXB0KSIKICAgIH0KICB9LAogICI5OSI6IHsKICAgICJpbnB1dHMiOiB7CiAgICAgICJzZWVkIjogMTk4MzY1NTIwOTE5MTQxLAogICAgICAic3RlcHMiOiA0LAogICAgICAiY2ZnIjogMSwKICAgICAgInNhbXBsZXJfbmFtZSI6ICJldWxlcl9hbmNlc3RyYWwiLAogICAgICAic2NoZWR1bGVyIjogInNpbXBsZSIsCiAgICAgICJkZW5vaXNlIjogMSwKICAgICAgIm1vZGVsIjogWwogICAgICAgICIzMCIsCiAgICAgICAgMAogICAgICBdLAogICAgICAicG9zaXRpdmUiOiBbCiAgICAgICAgIjEiLAogICAgICAgIDAKICAgICAgXSwKICAgICAgIm5lZ2F0aXZlIjogWwogICAgICAgICIzOSIsCiAgICAgICAgMAogICAgICBdLAogICAgICAibGF0ZW50X2ltYWdlIjogWwogICAgICAgICIxMzIiLAogICAgICAgIDAKICAgICAgXQogICAgfSwKICAgICJjbGFzc190eXBlIjogIktTYW1wbGVyIiwKICAgICJfbWV0YSI6IHsKICAgICAgInRpdGxlIjogIktTYW1wbGVyIgogICAgfQogIH0sCiAgIjEzMiI6IHsKICAgICJpbnB1dHMiOiB7CiAgICAgICJ3aWR0aCI6IDEyODAsCiAgICAgICJoZWlnaHQiOiA3MjAsCiAgICAgICJiYXRjaF9zaXplIjogMQogICAgfSwKICAgICJjbGFzc190eXBlIjogIkVtcHR5U0QzTGF0ZW50SW1hZ2UiLAogICAgIl9tZXRhIjogewogICAgICAidGl0bGUiOiAiRW1wdHlTRDNMYXRlbnRJbWFnZSIKICAgIH0KICB9LAogICIxNjAiOiB7CiAgICAiaW5wdXRzIjogewogICAgICAiUG93ZXJMb3JhTG9hZGVySGVhZGVyV2lkZ2V0IjogewogICAgICAgICJ0eXBlIjogIlBvd2VyTG9yYUxvYWRlckhlYWRlcldpZGdldCIKICAgICAgfSwKICAgICAgImxvcmFfMSI6IHsKICAgICAgICAib24iOiB0cnVlLAogICAgICAgICJsb3JhIjogIlF3ZW4tSW1hZ2UtRWRpdC0yNTA5LUxpZ2h0bmluZy00c3RlcHMtVjEuMC1iZjE2LnNhZmV0ZW5zb3JzIiwKICAgICAgICAic3RyZW5ndGgiOiAxCiAgICAgIH0sCiAgICAgICJsb3JhXzIiOiB7CiAgICAgICAgIm9uIjogdHJ1ZSwKICAgICAgICAibG9yYSI6ICJRd2VuLUVkaXQtMjUwOS1NdWx0aXBsZS1hbmdsZXMuc2FmZXRlbnNvcnMiLAogICAgICAgICJzdHJlbmd0aCI6IDEKICAgICAgfSwKICAgICAgImxvcmFfMyI6IHsKICAgICAgICAib24iOiB0cnVlLAogICAgICAgICJsb3JhIjogIm5leHQtc2NlbmVfbG9yYS12Mi0zMDAwLnNhZmV0ZW5zb3JzIiwKICAgICAgICAic3RyZW5ndGgiOiAwLjcKICAgICAgfSwKICAgICAgIuKelSBBZGQgTG9yYSI6ICIiLAogICAgICAibW9kZWwiOiBbCiAgICAgICAgIjMyIiwKICAgICAgICAwCiAgICAgIF0KICAgIH0sCiAgICAiY2xhc3NfdHlwZSI6ICJQb3dlciBMb3JhIExvYWRlciAocmd0aHJlZSkiLAogICAgIl9tZXRhIjogewogICAgICAidGl0bGUiOiAiUG93ZXIgTG9yYSBMb2FkZXIgKHJndGhyZWUpIgogICAgfQogIH0sCiAgIjE2NyI6IHsKICAgICJpbnB1dHMiOiB7CiAgICAgICJpbWFnZSI6ICJmdXR1cmUtY29tcGxldGUtYmFja2dyb3VuZC1wbGF0ZS1tcTgxYXI4Ny05bDA0emZfMDAwMDFfLnBuZyIKICAgIH0sCiAgICAiY2xhc3NfdHlwZSI6ICJMb2FkSW1hZ2UiLAogICAgIl9tZXRhIjogewogICAgICAidGl0bGUiOiAiTG9hZCBJbWFnZSIKICAgIH0KICB9LAogICIxNjgiOiB7CiAgICAiaW5wdXRzIjogewogICAgICAiaW1hZ2UiOiAiMDA5LnBuZyIKICAgIH0sCiAgICAiY2xhc3NfdHlwZSI6ICJMb2FkSW1hZ2UiLAogICAgIl9tZXRhIjogewogICAgICAidGl0bGUiOiAiTG9hZCBJbWFnZSIKICAgIH0KICB9Cn0=";

function otgCloneQwenNextSceneWorkflowV36BO1(): Record<string, any> {
  return JSON.parse(Buffer.from(OTG_QWEN_NEXT_SCENE_BASE_WORKFLOW_V36BO1_BASE64, "base64").toString("utf8")) as Record<string, any>;
}

function otgIsRecordV36BO1(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function otgGetNodeTitleV36BO1(node: Record<string, any>): string {
  const metaTitle = otgIsRecordV36BO1(node._meta) && typeof node._meta.title === "string" ? node._meta.title : "";
  const title = typeof node.title === "string" ? node.title : "";
  return `${metaTitle} ${title}`;
}

function otgGetPromptApiNodesV36BO1(workflow: unknown): Array<[string, Record<string, any>]> {
  if (!otgIsRecordV36BO1(workflow)) return [];
  if (Array.isArray(workflow.nodes)) return [];
  const entries: Array<[string, Record<string, any>]> = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (otgIsRecordV36BO1(node)) entries.push([nodeId, node]);
  }
  return entries;
}

function otgFindPromptTextV36BO1(workflow: unknown, positive: boolean): string {
  const nodes = otgGetPromptApiNodesV36BO1(workflow);
  for (const [, node] of nodes) {
    const classType = typeof node.class_type === "string" ? node.class_type : "";
    if (!classType.includes("TextEncodeQwenImageEdit")) continue;
    const title = otgGetNodeTitleV36BO1(node).toLowerCase();
    const isPositive = title.includes("positive");
    const isNegative = title.includes("negative");
    if (positive && isNegative) continue;
    if (!positive && isPositive) continue;
    if (otgIsRecordV36BO1(node.inputs) && typeof node.inputs.prompt === "string") return node.inputs.prompt;
  }

  if (positive) {
    for (const [, node] of nodes) {
      const classType = typeof node.class_type === "string" ? node.class_type : "";
      if (classType.includes("TextEncodeQwenImageEdit") && otgIsRecordV36BO1(node.inputs) && typeof node.inputs.prompt === "string") {
        return node.inputs.prompt;
      }
    }
  }

  return "";
}

function otgCleanNextScenePromptV36BO1(promptValue: unknown): string {
  let prompt = typeof promptValue === "string" ? promptValue.trim() : "";

  const hardStopMarkers = [
    "[OTG_TEMP_SCENE_ASSET_RULES_V36BN2]",
    "OTG_TEMP_SCENE_ASSET_RULES_V36BN2",
    "OTG anti-duplicate guard:",
    "Composition rules:",
    "Temporary Scene Asset rules for direct uploaded input/reference images:"
  ];

  for (const marker of hardStopMarkers) {
    const index = prompt.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0) prompt = prompt.slice(0, index).trim();
  }

  prompt = prompt
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();

  // Remove every repeated leading Next Scene / Next Scene 1 / Next Scene: prefix.
  // The route prepends exactly one clean prefix below.
  let previous = "";
  while (prompt && prompt !== previous) {
    previous = prompt;
    prompt = prompt.replace(/^next\s*scene(?:\s*\d+|\s*(?:one|two|three|four|five|six|seven|eight))?\s*[:;\-â€“â€”]?\s*/i, "").trim();
  }

  if (!prompt) prompt = "continue the scene";
  return `Next Scene: ${prompt}`;
}

function otgCleanNegativePromptV36BO1(promptValue: unknown): string {
  let prompt = typeof promptValue === "string" ? promptValue.trim() : "";
  const removeMarkers = [
    "OTG anti-duplicate guard:",
    "Composition rules:",
    "[OTG_TEMP_SCENE_ASSET_RULES_V36BN2]",
    "OTG_TEMP_SCENE_ASSET_RULES_V36BN2"
  ];

  for (const marker of removeMarkers) {
    const index = prompt.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0) prompt = prompt.slice(0, index).trim();
  }

  return prompt.replace(/\s+/g, " ").trim();
}

function otgGetImageNameByNodeRefV36BO1(workflow: unknown, refValue: unknown): string | null {
  if (!otgIsRecordV36BO1(workflow)) return null;
  if (!Array.isArray(refValue) || refValue.length < 1) return null;
  const nodeId = String(refValue[0]);
  const node = workflow[nodeId];
  if (!otgIsRecordV36BO1(node) || !otgIsRecordV36BO1(node.inputs)) return null;
  return typeof node.inputs.image === "string" && node.inputs.image.trim() ? node.inputs.image.trim() : null;
}

function otgPushUniqueImageNameV36BO1(images: string[], imageName: string | null): void {
  if (!imageName) return;
  const normalized = imageName.trim();
  if (!normalized) return;
  if (!images.includes(normalized)) images.push(normalized);
}

function otgCollectPromptApiImageNamesV36BO1(workflow: unknown): string[] {
  const images: string[] = [];
  const nodes = otgGetPromptApiNodesV36BO1(workflow);

  const positiveNodes = nodes.filter(([, node]) => {
    const classType = typeof node.class_type === "string" ? node.class_type : "";
    const title = otgGetNodeTitleV36BO1(node).toLowerCase();
    return classType.includes("TextEncodeQwenImageEdit") && !title.includes("negative");
  });

  for (const [, node] of positiveNodes) {
    if (!otgIsRecordV36BO1(node.inputs)) continue;
    for (let index = 1; index <= 8; index += 1) {
      otgPushUniqueImageNameV36BO1(images, otgGetImageNameByNodeRefV36BO1(workflow, node.inputs[`image${index}`]));
    }
  }

  for (const [, node] of nodes) {
    const classType = typeof node.class_type === "string" ? node.class_type : "";
    if (classType !== "LoadImage" || !otgIsRecordV36BO1(node.inputs)) continue;
    if (typeof node.inputs.image === "string") otgPushUniqueImageNameV36BO1(images, node.inputs.image);
  }

  return images;
}

function buildProductionPictureQwenNextSceneWorkflowV36BO1(sourceWorkflow: any): any {
  const imageNames = otgCollectPromptApiImageNamesV36BO1(sourceWorkflow);
  if (imageNames.length > 3) {
    throw new Error("OTG_V36BO1_MAX_3_IMAGES: Production Picture supports a maximum of 3 image references per generation. Use either 3 characters, or 1 background plus up to 2 characters/assets.");
  }
  if (imageNames.length < 1) {
    return sourceWorkflow;
  }

  const workflow = otgCloneQwenNextSceneWorkflowV36BO1();
  const positivePrompt = otgCleanNextScenePromptV36BO1(otgFindPromptTextV36BO1(sourceWorkflow, true));
  const negativePrompt = otgFindPromptTextV36BO1(sourceWorkflow, false);

  workflow["1"].inputs.prompt = positivePrompt;
  workflow["39"].inputs.prompt = otgCleanNegativePromptV36BO1(negativePrompt);

  workflow["11"].inputs.image = imageNames[0];
  workflow["1"].inputs.image1 = ["11", 0];
  workflow["39"].inputs.image1 = ["11", 0];

  if (imageNames.length >= 2) {
    workflow["167"].inputs.image = imageNames[1];
    workflow["1"].inputs.image2 = ["167", 0];
  } else {
    delete workflow["1"].inputs.image2;
    delete workflow["167"];
  }

  if (imageNames.length >= 3) {
    workflow["168"].inputs.image = imageNames[2];
    workflow["1"].inputs.image3 = ["168", 0];
  } else {
    delete workflow["1"].inputs.image3;
    delete workflow["168"];
  }

  workflow["132"].inputs.width = 1280;
  workflow["132"].inputs.height = 720;
  workflow["132"].inputs.batch_size = 1;
  workflow["99"].inputs.seed = Math.floor(Math.random() * 900000000000000) + 1;

  return workflow;
}
// END OTG V36BO1

export async function POST(req: NextRequest) {
  const otgTemporarySceneAssetsV36BN2 = extractTemporarySceneAssetsV36BN2(
    await readTemporarySceneAssetSourceV36BN2(req)
  );

  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  // OTG_PRODUCTION_PICTURE_OWNER_CONTEXT_V36AX
  // Keep the original NextRequest for getOwnerContext because it needs cookies/headers.
  // Read JSON from a cloned request body so owner lookup cannot consume the original stream.
  const productionPictureBodyRequestV36AX = req.clone();

  let ownerCtx: Awaited<ReturnType<typeof getOwnerContext>>;
  try {
    ownerCtx = await getOwnerContext(req);
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await productionPictureBodyRequestV36AX.json().catch(() => null)) as ProductionPictureRequest | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const storyboardCount = Math.max(1, Math.min(5, Number(body.storyboardCount || 1)));
    const workflowFile = String(body.workflowFile || `storyboard/${storyboardCount === 1 ? "StoryBoard 1" : `Storyboard ${storyboardCount}`}.json`);
    let characterImages = Array.isArray(body.characterImages) ? body.characterImages.filter(Boolean) : [];
  // OTG_PRODUCTION_PICTURE_RESOLVE_CHARACTER_IMAGES_V36AY
  characterImages = await Promise.all(
    characterImages.map((image) => resolveProductionPictureInputImagePathV36AY(image)),
  );
    if (characterImages.length !== storyboardCount) {
      return NextResponse.json({ ok: false, error: `Storyboard ${storyboardCount} requires ${storyboardCount} character image(s).` }, { status: 400 });
    }

    const workflowPath = resolveWorkflowPath(workflowFile);
    const workflow = JSON.parse(await fs.readFile(workflowPath, "utf8"));

    const baseUrl = normalizeBaseUrl(configuredImageComfyBaseUrl());
    logComfyRouting(
      "/api/production/picture POST",
      { requestKind: "production-picture", workflowLabel: "Production Picture", mediaType: "image" },
      { kind: "image", baseUrl }
    );
    const objectInfo = await fetchObjectInfo(baseUrl);
    const deviceId = safeDeviceId(ownerCtx.deviceId);
    const comfyClientId = `${deviceId}-production-picture`;

    const uploadedImages = [];
    for (const imagePath of characterImages) {
      uploadedImages.push(await uploadImageToComfy(baseUrl, path.resolve(imagePath)));
    }

    const patchInfo = patchWorkflow(workflow, body, uploadedImages, objectInfo);
    const productionPictureSeedSizePatchV36BM = enforceProductionPictureSeedSizePromptV36BM(
      workflow,
      patchInfo.promptText
    );
    const expectedPrefix = String(workflow?.[patchInfo.saveNodeId || ""]?.inputs?.filename_prefix || "");

    const submitRes = await fetchStage(
      `${baseUrl}/prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: buildProductionPictureQwenNextSceneWorkflowV36BO1(workflow) as any, client_id: comfyClientId }),
      },
      "submit_prompt",
      30_000
    );
    const submitParsed = await readJsonOrText(submitRes);
    const submitJson: any = submitParsed.json;
    if (!submitRes.ok || !submitJson?.prompt_id) {
      throw new StageError("submit_prompt", `Comfy submit failed (${submitRes.status}).`, submitRes.status, submitJson ?? submitParsed.text);
    }

    const promptId = String(submitJson.prompt_id);
    appendJobLog(
      {
        ts: Date.now(),
        ownerKey: ownerCtx.ownerKey,
        username: ownerCtx.username ?? null,
        deviceId,
        title: "Production Picture",
        preset: workflowFile.replace(/\.json$/i, ""),
        prompt_id: promptId,
        positivePrompt: body.positivePrompt || null,
        negativePrompt: body.negativePrompt || null,
        imagePath: characterImages[0] || null,
        submitPayload: body,
        rawResponse: submitJson,
      },
      deviceId
    );

    const startedAt = Date.now();
    let chosenFile: HistoryFile | null = null;
    let lastHistorySummary: any = null;
    while (Date.now() - startedAt < POLL_MAX_MS) {
      const history = await fetchHistoryRecord(baseUrl, promptId);
      const record = history.record;
      const files = extractImageFilesFromHistory(record);
      lastHistorySummary = {
        source: history.source,
        status: record?.status ?? null,
        nodeIds: Object.keys(record?.outputs || {}),
        fileCount: files.length,
        files,
      };
      chosenFile = chooseBestHistoryFile(files, expectedPrefix);
      if (chosenFile) break;
      await sleep(POLL_INTERVAL_MS);
    }

    if (!chosenFile) {
      throw new StageError("poll_history", "Timed out waiting for Production picture output.", 504, {
        promptId,
        endpoint: baseUrl,
        expectedPrefix,
        productionPictureSeedSizePatchV36BM,
        lastHistorySummary,
      });
    }

    const bytes = await fetchViewBytes(baseUrl, chosenFile);
    const outputDir = buildOutputDir(ownerCtx.ownerKey, body.productionId || body.productionName || "production");
    const finalExt = safeExt(chosenFile.filename);
    const finalName = `${Date.now()}_${path.basename(chosenFile.filename, path.extname(chosenFile.filename))}${finalExt}`;
    const finalAbs = path.join(outputDir, finalName);
    await fs.writeFile(finalAbs, bytes);

    const imageUrl = `/api/file?path=${encodeURIComponent(finalAbs)}`;
    return NextResponse.json({
      ok: true,
      promptId,
      endpoint: baseUrl,
      workflowFile,
      imagePath: finalAbs,
      imageUrl,
      imageExt: finalExt,
      serverPath: finalAbs,
      serverUrl: imageUrl,
      generatedImagePath: finalAbs,
      generatedImageUrl: imageUrl,
      remoteFile: chosenFile,
      debug: {
        promptLineId: patchInfo.promptLineId,
        promptPatchedNodes: patchInfo.promptPatchedNodes,
        saveNodeId: patchInfo.saveNodeId,
        loadNodes: patchInfo.loadNodes,
        modelRefChanges: patchInfo.modelRefChanges,
        modelInventory: patchInfo.modelInventory,
        expectedPrefix,
        productionPictureSeedSizePatchV36BM,
      },
    });
  } catch (error: any) {
    if (error instanceof StageError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          stage: error.stage,
          status: error.status || 500,
          detail: error.detail ?? null,
        },
        { status: error.status || 500 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to create Production picture",
        stage: "unhandled",
      },
      { status: 500 }
    );
  }
}





