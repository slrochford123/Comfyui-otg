import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";

import { configuredImageComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";

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

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();

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
    const body = (await req.json().catch(() => null)) as ProductionPictureRequest | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const storyboardCount = Math.max(1, Math.min(5, Number(body.storyboardCount || 1)));
    const workflowFile = String(body.workflowFile || `storyboard/${storyboardCount === 1 ? "StoryBoard 1" : `Storyboard ${storyboardCount}`}.json`);
    const characterImages = Array.isArray(body.characterImages) ? body.characterImages.filter(Boolean) : [];
    if (characterImages.length !== storyboardCount) {
      return NextResponse.json({ ok: false, error: `Storyboard ${storyboardCount} requires ${storyboardCount} character image(s).` }, { status: 400 });
    }

    const workflowPath = resolveWorkflowPath(workflowFile);
    const workflow = JSON.parse(await fs.readFile(workflowPath, "utf8"));

    const baseUrl = normalizeBaseUrl(configuredImageComfyBaseUrl());
    const objectInfo = await fetchObjectInfo(baseUrl);
    const deviceId = safeDeviceId(ownerCtx.deviceId);
    const comfyClientId = `${deviceId}-production-picture`;

    const uploadedImages = [];
    for (const imagePath of characterImages) {
      uploadedImages.push(await uploadImageToComfy(baseUrl, path.resolve(imagePath)));
    }

    const patchInfo = patchWorkflow(workflow, body, uploadedImages, objectInfo);
    const expectedPrefix = String(workflow?.[patchInfo.saveNodeId || ""]?.inputs?.filename_prefix || "");

    const submitRes = await fetchStage(
      `${baseUrl}/prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: comfyClientId }),
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
