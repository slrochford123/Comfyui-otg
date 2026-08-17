import { NextRequest } from "next/server";
import { configuredComfyBaseUrlForJob, logComfyRouting } from "@/app/api/_lib/comfyTarget";
import { selectManifestBackend } from "@/lib/comfyCapabilities";
import {
  logVideoBackendJob,
  prepareFallbackGraph,
  probeVideoBackend,
  selectVideoBackend,
  videoBackends,
  type VideoLoraRoutingOptions,
} from "@/lib/videoBackendFailover";
import { fetchAllVideoLoraInventories } from "@/lib/videoLoraInventory";
import { shouldAttemptVideoSubmissionFallback } from "@/lib/videoSubmissionFailover";
import {
  applyVideoLoras,
  publicVideoLoraSelectionMetadata,
  resolveVideoLoraSelections,
  VideoLoraCompatibilityError,
  type ValidatedVideoLora,
} from "@/lib/videoLoras";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import { loadWorkflowById, extractPromptGraph, validatePromptGraph } from "@/lib/workflows";
import { normalizeExplicitCreateVideoFromImagesRequest } from "@/lib/videoWorkflowRequestNormalization";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { readState, markRunning, writeState } from "@/lib/contentState";
import { writePromptRequestMeta } from "@/lib/promptRequestMeta";
import { ensureComfyClientProgressMonitor, recordComfyPromptSubmitted, waitForComfyClientProgressMonitor } from "@/lib/comfyProgress";
import { readImageLoraCatalog } from "@/lib/imageLoraCatalogServer";
import { submitComfyPromptWith5060Lease } from "@/lib/workers/comfyPromptLease";
import {
  IMAGE_LORA_ADULT_ACK_VERSION,
  applyEditImageReferences,
  applyImageLoraSelections,
  applyLockedImageSize,
  imageModelById,
} from "@/lib/imageGenerateWorkflows";
import {
  applyWan22GenerateOverrides,
  videoGenerateSelectionForWorkflowId,
} from "@/lib/videoGenerateWorkflows";


// OTG_PRODUCTION_ANIMATE_BACKEND_EXACT_PROMPT_V29
function otgStripStoryboardContextFromAnimatePromptV29(value: string): string {
  let text = String(value || "").replace(/\r\n/g, "\n");
  if (!/Scene context:/i.test(text)) return value;
  text = text.replace(/^\s*Scene context:[\s\S]*?(?:\n\s*\n|$)/i, "");
  text = text.replace(/^\s*Scene context:[\s\S]*?this clip\.\s*/i, "");
  text = text.replace(/^\s*Maintain visual continuity with the storyboard frame\.\s*/i, "");
  text = text.replace(/^\s*No recurring character is intentionally present in this clip\.\s*/i, "");
  return text.trim();
}

function otgSanitizeAnimatePromptObjectV29(value: unknown): unknown {
  if (typeof value === "string") return otgStripStoryboardContextFromAnimatePromptV29(value);
  if (Array.isArray(value)) return value.map((item) => otgSanitizeAnimatePromptObjectV29(item));
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const meta = input._meta as Record<string, unknown> | undefined;
  const nodeTitle = String(input.title || meta?.title || input.name || "").toLowerCase();
  const isPositivePromptNode = nodeTitle.includes("positive prompt") || nodeTitle === "positive";

  for (const [key, child] of Object.entries(input)) {
    const lowered = key.toLowerCase();

    if (typeof child === "string") {
      const stripped = otgStripStoryboardContextFromAnimatePromptV29(child);

      if (lowered.includes("globalprompt") || lowered === "scenecontext" || lowered === "contextprompt") {
        output[key] = "";
        continue;
      }

      if (isPositivePromptNode && (lowered === "text" || lowered === "prompt" || lowered === "positive" || lowered === "string")) {
        output[key] = stripped;
        continue;
      }

      output[key] = stripped;
      continue;
    }

    output[key] = otgSanitizeAnimatePromptObjectV29(child);
  }

  return output;
}

function otgSanitizeComfyPromptBodyV29(body: unknown): unknown {
  if (typeof body !== "string" || !body.includes("Scene context:")) return body;
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(otgSanitizeAnimatePromptObjectV29(parsed));
  } catch {
    return body.replace(/^\s*Scene context:[\s\S]*?(?:\n\s*\n|$)/i, "");
  }
}

function otgInstallComfyPromptFetchPatchV29() {
  const globalRef = globalThis as typeof globalThis & {
    __otgComfyPromptFetchOriginalV29?: typeof fetch;
    __otgComfyPromptFetchPatchedV29?: boolean;
  };

  if (globalRef.__otgComfyPromptFetchPatchedV29) return;

  globalRef.__otgComfyPromptFetchOriginalV29 = globalThis.fetch.bind(globalThis) as typeof fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String((input as Request).url || "");
      const method = String(init?.method || "GET").toUpperCase();
      const shouldSanitize =
        method === "POST" &&
        (url.includes("/prompt") || url.toLowerCase().includes("comfy")) &&
        typeof init?.body === "string" &&
        init.body.includes("Scene context:");

      if (shouldSanitize) {
        init = { ...(init || {}), body: otgSanitizeComfyPromptBodyV29(init?.body) as BodyInit };
      }
    } catch {
      // Do not block Comfy requests if sanitizer fails.
    }

    return globalRef.__otgComfyPromptFetchOriginalV29!(input, init);
  }) as typeof fetch;

  globalRef.__otgComfyPromptFetchPatchedV29 = true;
}

otgInstallComfyPromptFetchPatchV29();

import { applyWanRifeFrameTiming } from "@/lib/wanRifeFrameTiming";

export const runtime = "nodejs";

const OTG_DATA_DIR = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
const JOBS_DIR = path.join(OTG_DATA_DIR, "device_jobs");

const OTG_MAX_PIXELS = Number.isFinite(Number(process.env.OTG_MAX_PIXELS))
  ? Math.floor(Number(process.env.OTG_MAX_PIXELS))
  : 1280 * 720;

const OTG_MAX_FRAMES = Number.isFinite(Number(process.env.OTG_MAX_FRAMES))
  ? Math.floor(Number(process.env.OTG_MAX_FRAMES))
  : 3601;

const OTG_GENERATE_DURATION_OPTIONS = [5, 10, 15] as const;
type OtgGenerateDurationSeconds = (typeof OTG_GENERATE_DURATION_OPTIONS)[number];

function clampGenerateDurationSeconds(value: any): OtgGenerateDurationSeconds {
  const fallback = OTG_GENERATE_DURATION_OPTIONS[0];
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  let best: OtgGenerateDurationSeconds = fallback;
  let bestDelta = Math.abs(num - best);
  for (const option of OTG_GENERATE_DURATION_OPTIONS) {
    const delta = Math.abs(num - option);
    if (delta < bestDelta) {
      best = option;
      bestDelta = delta;
    }
  }
  return best;
}


type OtgLoraChoice = {
  name: string;
  strengthModel?: number;
  strengthClip?: number;
};

function sanitizeFilenamePrefix__otg(title: any) {
  const t = String(title || "").trim();
  if (!t) return "";
  return t
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function setFilenamePrefix__otg(graph: any, title: any) {
  const prefix = sanitizeFilenamePrefix__otg(title);
  if (!prefix) return;

  for (const nodeId of Object.keys(graph || {})) {
    const node = (graph as any)[nodeId];
    if (!node || typeof node !== "object") continue;
    const inputs = (node as any).inputs;
    if (!inputs || typeof inputs !== "object") continue;

    if (typeof (inputs as any).filename_prefix === "string") {
      (inputs as any).filename_prefix = prefix;
    }
    if (typeof (inputs as any).file_prefix === "string") {
      (inputs as any).file_prefix = prefix;
    }
  }
}

function safeDeviceId(raw: string | null) {
  const v = (raw || "").toString().trim();
  const cleaned = v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return cleaned || null;
}

function makeFallbackDeviceId() {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

function getDeviceIdFromReq(req: NextRequest) {
  const fromHeader = safeDeviceId(req.headers.get("x-otg-device-id"));
  if (fromHeader) return fromHeader;

  const fromCookie = safeDeviceId(req.cookies.get("otg_device_id")?.value || null);
  if (fromCookie) return fromCookie;

  return makeFallbackDeviceId();
}

function makeComfyClientId(deviceId: string) {
  const safe = safeDeviceId(deviceId) || "device";
  return `otg_${safe}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function setTextEncodes(graph: any, positive: string, negative: string, otgMeta?: any) {
  if (!graph || typeof graph !== "object") return;

  const nodes: Record<string, any> = graph;

  const assign = (node: any, keys: string[], value: string) => {
    if (!node?.inputs) return false;
    for (const k of keys) {
      if (typeof node.inputs?.[k] === "string") {
        node.inputs[k] = value;
        return true;
      }
    }
    return false;
  };

  const setPositiveOnNode = (id: string) => {
    const node = nodes[id];
    if (!node) return;
    if (assign(node, ["text", "prompt", "caption", "positive", "positive_prompt"], positive)) return;
    for (const [k, v] of Object.entries(node.inputs || {})) {
      if (String(k) === "reference_latents_method") continue;
      if (typeof v === "string") {
        (node.inputs as any)[k] = positive;
        return;
      }
    }
  };

  const setNegativeOnNode = (id: string) => {
    const node = nodes[id];
    if (!node) return;
    if (assign(node, ["text", "prompt", "caption", "negative", "negative_prompt"], negative)) return;
    for (const [k, v] of Object.entries(node.inputs || {})) {
      if (String(k) === "reference_latents_method") continue;
      if (typeof v === "string") {
        (node.inputs as any)[k] = negative;
        return;
      }
    }
  };

  const metaPos: string[] = [];
  const metaNeg: string[] = [];

  if (otgMeta && typeof otgMeta === "object") {
    const p =
      otgMeta.promptNodeId ??
      otgMeta.positiveNodeId ??
      otgMeta.positiveTextNodeId ??
      otgMeta.positiveTextNode;
    const n = otgMeta.negativeNodeId ?? otgMeta.negativeTextNodeId ?? otgMeta.negativeTextNode;

    if (Array.isArray(otgMeta.promptNodeIds)) metaPos.push(...otgMeta.promptNodeIds.map(String));
    if (Array.isArray(otgMeta.positiveNodeIds)) metaPos.push(...otgMeta.positiveNodeIds.map(String));
    if (p !== undefined && p !== null) metaPos.push(String(p));

    if (Array.isArray(otgMeta.negativeNodeIds)) metaNeg.push(...otgMeta.negativeNodeIds.map(String));
    if (n !== undefined && n !== null) metaNeg.push(String(n));
  }

  if (metaPos.length) {
    for (const id of Array.from(new Set(metaPos))) setPositiveOnNode(id);
  }
  if (metaNeg.length) {
    for (const id of Array.from(new Set(metaNeg))) setNegativeOnNode(id);
  }
  if (metaPos.length || metaNeg.length) return;

  const posTargets = new Set<string>();
  const negTargets = new Set<string>();

  for (const [, node] of Object.entries(nodes)) {
    const inputs = (node as any)?.inputs;
    if (!inputs) continue;
    for (const [k, v] of Object.entries(inputs)) {
      if (!Array.isArray(v) || v.length < 2) continue;
      const srcId = String(v[0]);
      const key = String(k).toLowerCase();
      if (key.includes("neg")) negTargets.add(srcId);
      else if (key.includes("pos") || key.includes("cond") || key.includes("conditioning")) posTargets.add(srcId);
    }
  }

  if (posTargets.size) {
    for (const id of posTargets) setPositiveOnNode(id);
  }
  if (negTargets.size) {
    for (const id of negTargets) setNegativeOnNode(id);
  }
  if (posTargets.size || negTargets.size) return;

  const textLike = Object.entries(nodes)
    .map(([id, node]) => ({ id, node: node as any }))
    .filter((x) => x?.node?.inputs && (typeof x.node.inputs.text === "string" || typeof x.node.inputs.prompt === "string"))
    .filter((x) => /textencode|cliptextencode|t5|prompt/i.test(String(x.node.class_type || "")));

  if (textLike[0]) setPositiveOnNode(textLike[0].id);
  if (textLike[1]) setNegativeOnNode(textLike[1].id);
}

function applySelectedLoras(graph: any, loras: OtgLoraChoice[] | null | undefined) {
  if (!graph || typeof graph !== "object") return { applied: 0, available: 0 };
  if (!Array.isArray(loras) || loras.length === 0) return { applied: 0, available: 0 };

  const nodes: Record<string, any> = graph;

  const clamp = (v: any, dflt: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(0, Math.min(2, n));
  };

  const slotIds: { high?: string; low?: string } = {};
  const genericSlots: string[] = [];
  const allLoraNodes: { id: string; node: any }[] = [];

  for (const [id, node] of Object.entries(nodes)) {
    const ct = String((node as any)?.class_type || "");
    const inputs = (node as any)?.inputs;
    if (!inputs || typeof inputs !== "object") continue;

    const hasLoraName = typeof (inputs as any).lora_name === "string" || typeof (inputs as any).lora === "string";
    const looksLike = /lora/i.test(ct) && hasLoraName;
    const classic = ct === "LoraLoader" || ct === "LoRALoader" || ct === "LoraLoaderModelOnly";
    if (!(classic || looksLike)) continue;

    allLoraNodes.push({ id: String(id), node });

    const ln = String((inputs as any).lora_name || (inputs as any).lora || "");
    if (ln === "__otg_user_high__") slotIds.high = String(id);
    else if (ln === "__otg_user_low__") slotIds.low = String(id);
    else if (ln === "__otg_user__") genericSlots.push(String(id));
  }

  allLoraNodes.sort((a, b) => {
    const an = Number(a.id);
    const bn = Number(b.id);
    const aNum = Number.isFinite(an);
    const bNum = Number.isFinite(bn);
    if (aNum && bNum) return an - bn;
    if (aNum) return -1;
    if (bNum) return 1;
    return a.id.localeCompare(b.id);
  });

  const isWanGraph = Object.values(nodes).some((n: any) => String(n?.class_type || "") === "EmptyHunyuanLatentVideo");
  const isWanCoreLora = (name: string) => /wan2\.2_.*lightx2v_4steps_lora.*_(high|low)_noise/i.test(name);

  const writeChoiceToNode = (node: any, choice: OtgLoraChoice) => {
    if (!node?.inputs) return false;
    const inputs = node.inputs;
    const name = String(choice?.name || "").trim();
    if (!name) return false;

    if (typeof inputs.lora_name === "string") inputs.lora_name = name;
    else if (typeof inputs.lora === "string") inputs.lora = name;

    if (typeof inputs.strength_model === "number") inputs.strength_model = clamp(choice?.strengthModel, inputs.strength_model);
    if (typeof inputs.strength_clip === "number") inputs.strength_clip = clamp(choice?.strengthClip, inputs.strength_clip);
    if (typeof inputs.model_strength === "number") inputs.model_strength = clamp(choice?.strengthModel, inputs.model_strength);
    if (typeof inputs.clip_strength === "number") inputs.clip_strength = clamp(choice?.strengthClip, inputs.clip_strength);
    return true;
  };

  let applied = 0;

  // OTG_PRODUCTION_POWER_LORA_LOADER_V23_START
  // Production LTX 2.3 workflows use "Power Lora Loader (rgthree)" with lora_1, lora_2, etc.
  // IMPORTANT: keep every workflow-authored LORA exactly as-is.
  // App-selected LORAs are appended as extra optional slots after the highest existing lora_N slot.
  const powerLoraLoaders = Object.entries(nodes)
    .map(([id, node]) => ({ id: String(id), node: node as any }))
    .filter(({ node }) => /power\s*lora\s*loader/i.test(String(node?.class_type || "")) && node?.inputs && typeof node.inputs === "object");

  if (powerLoraLoaders.length) {
    const optionalLoras = loras
      .map((choice) => ({
        name: String(choice?.name || "").trim(),
        strength: clamp((choice as any)?.strength ?? choice?.strengthModel ?? choice?.strengthClip, 1),
      }))
      .filter((choice) => choice.name)
      .slice(0, 3);

    for (const { node } of powerLoraLoaders) {
      const existingSlotNumbers = Object.keys(node.inputs)
        .filter((key) => /^lora_\d+$/i.test(key))
        .map((key) => Number(key.replace(/\D/g, "")))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);

      const highestExistingSlot = existingSlotNumbers.length ? Math.max(...existingSlotNumbers) : 0;

      optionalLoras.forEach((choice, optionalIndex) => {
        const slotKey = `lora_${highestExistingSlot + optionalIndex + 1}`;

        // Add new optional slots only. Do not alter original workflow slots,
        // including their on/off state, names, strengths, or ordering.
        node.inputs[slotKey] = {
          on: true,
          lora: choice.name,
          strength: choice.strength,
        };

        applied++;
      });
    }

    return { applied, available: powerLoraLoaders.length ? 3 : 0 };
  }
  // OTG_PRODUCTION_POWER_LORA_LOADER_V23_END

  if (isWanGraph && (slotIds.high || slotIds.low)) {
    const highs = loras.filter((l) => /high/i.test(String(l?.name || "")));
    const lows = loras.filter((l) => !/high/i.test(String(l?.name || "")));

    if (slotIds.high && highs[0]) {
      if (writeChoiceToNode(nodes[slotIds.high], highs[0])) applied++;
    }
    if (slotIds.low && (lows[0] || highs[1])) {
      const pick = lows[0] || highs[1];
      if (pick && writeChoiceToNode(nodes[slotIds.low], pick)) applied++;
    }
    return { applied, available: (slotIds.high ? 1 : 0) + (slotIds.low ? 1 : 0) };
  }

  const isFastLtx2I2vGraph =
    nodes["187"]?.class_type === "UnetLoaderGGUF" &&
    nodes["197"]?.class_type === "LoraLoaderModelOnly" &&
    nodes["192"]?.class_type === "LTXVChunkFeedForward" &&
    nodes["195"]?.class_type === "LTXVChunkFeedForward";

  if (isFastLtx2I2vGraph) {
    const optionalLoras = loras
      .map((choice) => ({
        name: String(choice?.name || "").trim(),
        strength: clamp((choice as any)?.strength ?? choice?.strengthModel ?? choice?.strengthClip, 1),
      }))
      .filter((choice) => choice.name)
      .slice(0, 3);

    if (!optionalLoras.length) return { applied: 0, available: 3 };

    const numericIds = Object.keys(nodes)
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));
    let nextNodeId = Math.max(1000, ...numericIds) + 1;
    let previousModelRef: [string, number] = ["197", 0];

    for (const choice of optionalLoras) {
      const nodeId = String(nextNodeId++);
      nodes[nodeId] = {
        inputs: {
          lora_name: choice.name,
          strength_model: choice.strength,
          model: previousModelRef,
        },
        class_type: "LoraLoaderModelOnly",
        _meta: {
          title: "App Selected LoRA",
        },
      };
      previousModelRef = [nodeId, 0];
      applied++;
    }

    for (const nodeId of ["192", "195"]) {
      if (nodes[nodeId]?.inputs?.model?.[0] === "197") {
        nodes[nodeId].inputs.model = previousModelRef;
      }
    }

    return { applied, available: 3 };
  }

  const targetNodes = allLoraNodes.filter(({ node }) => {
    const inputs = node?.inputs;
    const ln = String(inputs?.lora_name || inputs?.lora || "");
    if (isWanGraph && isWanCoreLora(ln)) return false;
    return true;
  });

  const count = Math.min(targetNodes.length, loras.length);
  for (let i = 0; i < count; i++) {
    if (writeChoiceToNode(targetNodes[i].node, loras[i])) applied++;
  }

  return { applied, available: targetNodes.length };
}

async function validateLorasAvailableAtBackend(comfyBaseUrl: string, names: string[]) {
  if (!names.length) return { ok: true as const, missing: [] as string[] };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${comfyBaseUrl.replace(/\/$/, "")}/object_info/LoraLoaderModelOnly`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false as const, missing: names, error: `LoRA inventory check returned HTTP ${response.status}.` };
    }
    const inventoryText = JSON.stringify(await response.json()).toLowerCase();
    const missing = names.filter((name) => !inventoryText.includes(name.toLowerCase()));
    return missing.length
      ? { ok: false as const, missing, error: "One or more selected LoRAs are not installed on the active ComfyUI backend." }
      : { ok: true as const, missing: [] as string[] };
  } catch (error: any) {
    return { ok: false as const, missing: names, error: `Unable to verify LoRAs on the active ComfyUI backend: ${String(error?.message || error)}` };
  } finally {
    clearTimeout(timeout);
  }
}

function setSeedAuto(graph: any, seedMode: "random" | "fixed" | undefined, seedIn: any) {
  if (!graph || typeof graph !== "object") return { seed: null as number | null };

  const mode = seedMode === "fixed" ? "fixed" : "random";
  let seed = Number(seedIn);

  if (!Number.isFinite(seed) || seed <= 0 || seed > 2147483647) {
    seed = Math.floor(Math.random() * 2147483647) + 1;
  }

  if (mode === "random") {
    seed = Math.floor(Math.random() * 2147483647) + 1;
  }

  const ids = Object.keys(graph).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    const aNum = Number.isFinite(an);
    const bNum = Number.isFinite(bn);
    if (aNum && bNum) return an - bn;
    if (aNum) return -1;
    if (bNum) return 1;
    return a.localeCompare(b);
  });

  let i = 0;
  for (const id of ids) {
    const node = (graph as any)[id];
    const inputs = node?.inputs;
    if (!inputs || typeof inputs !== "object") continue;

    const derived = (seed + i * 9973) % 2147483647 || seed;
    for (const k of ["seed", "noise_seed"]) {
      const v = (inputs as any)[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        (inputs as any)[k] = derived;
      }
    }
    i++;
  }

  return { seed };
}

function setSize(graph: any, width: number, height: number) {
  if (!graph || typeof graph !== "object") return;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  const w = Math.max(64, Math.floor(width));
  const h = Math.max(64, Math.floor(height));

  const keysW = ["width", "w", "image_width", "frame_width"];
  const keysH = ["height", "h", "image_height", "frame_height"];

  for (const node of Object.values(graph) as any[]) {
    if (!node?.inputs) continue;
    for (const k of keysW) {
      if (typeof node.inputs?.[k] === "number") node.inputs[k] = w;
    }
    for (const k of keysH) {
      if (typeof node.inputs?.[k] === "number") node.inputs[k] = h;
    }
  }
}

function inferFps(graph: any): number {
  if (!graph || typeof graph !== "object") return 8;
  for (const node of Object.values(graph) as any[]) {
    const v = node?.inputs?.fps ?? node?.inputs?.frame_rate ?? node?.inputs?.framerate;
    if (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 120) {
      return Math.floor(v);
    }
  }
  return 8;
}

function clampSizeToMaxPixels(width: number, height: number) {
  const w = Math.max(64, Math.floor(width));
  const h = Math.max(64, Math.floor(height));
  const px = w * h;
  if (px <= OTG_MAX_PIXELS) return { width: w, height: h, clamped: false };

  const scale = Math.sqrt(OTG_MAX_PIXELS / px);
  const nw = Math.max(64, Math.floor((w * scale) / 8) * 8);
  const nh = Math.max(64, Math.floor((h * scale) / 8) * 8);
  return { width: nw, height: nh, clamped: true };
}

function clampFrames(frames: number) {
  const f = Math.max(1, Math.floor(frames));
  if (f <= OTG_MAX_FRAMES) return { frames: f, clamped: false };
  return { frames: OTG_MAX_FRAMES, clamped: true };
}

function setFrameCount(graph: any, frames: number) {
  if (!graph || typeof graph !== "object") return;
  if (!Number.isFinite(frames)) return;
  const f = Math.max(1, Math.floor(frames));

  const frameKeys = ["num_frames", "frames", "frame_count", "n_frames", "length", "video_length", "max_frames"];

  for (const node of Object.values(graph) as any[]) {
    if (!node?.inputs) continue;
    for (const k of frameKeys) {
      if (typeof node.inputs?.[k] === "number") node.inputs[k] = f;
    }
  }
}

function setDurationSeconds(graph: any, seconds: number, otgMeta?: any) {
  if (!Number.isFinite(seconds)) return;
  const sec = Math.max(0, Math.floor(seconds));
  let durationSet = false;

  const applyDurationToNode = (node: any) => {
    if (!node?.inputs || typeof node.inputs !== "object") return false;
    const keys = [
      "value",
      "seconds",
      "duration",
      "duration_seconds",
      "durationSeconds",
      "length_seconds",
      "lengthSeconds",
    ];
    for (const key of keys) {
      if (typeof node.inputs?.[key] === "number") {
        node.inputs[key] = sec;
        return true;
      }
    }
    return false;
  };

  const durationNodeIds: string[] = [];
  if (otgMeta && typeof otgMeta === "object") {
    if (Array.isArray(otgMeta.durationNodeIds)) durationNodeIds.push(...otgMeta.durationNodeIds.map(String));
    if (otgMeta.durationNodeId !== undefined && otgMeta.durationNodeId !== null) {
      durationNodeIds.push(String(otgMeta.durationNodeId));
    }
  }

  for (const id of Array.from(new Set(durationNodeIds))) {
    if (applyDurationToNode((graph as any)?.[id])) durationSet = true;
  }

  if (!durationSet && graph && typeof graph === "object") {
    for (const node of Object.values(graph) as any[]) {
      const title = String(node?._meta?.title || "").toLowerCase();
      const classType = String(node?.class_type || "").toLowerCase();
      const looksLikeDuration =
        title.includes("seconds") ||
        title.includes("duration") ||
        (title.includes("length") && !title.includes("frame"));
      const compatibleType =
        classType.includes("constant") ||
        classType.includes("primitive") ||
        classType.includes("int") ||
        classType.includes("float");
      if (looksLikeDuration && compatibleType && applyDurationToNode(node)) {
        durationSet = true;
      }
    }
  }

  if (durationSet) return;

  const fps = inferFps(graph);
  const frames = Math.max(1, sec === 0 ? 1 : sec * fps);
  const cf = clampFrames(frames);
  setFrameCount(graph, cf.frames);
}
function inferAnySize(graph: any): { width: number; height: number } | null {
  if (!graph || typeof graph !== "object") return null;
  const keysW = ["width", "w", "image_width", "frame_width"];
  const keysH = ["height", "h", "image_height", "frame_height"];

  for (const node of Object.values(graph) as any[]) {
    const inputs = node?.inputs;
    if (!inputs) continue;

    let w: number | null = null;
    let h: number | null = null;

    for (const k of keysW) {
      if (typeof inputs?.[k] === "number" && Number.isFinite(inputs[k])) {
        w = inputs[k];
        break;
      }
    }

    for (const k of keysH) {
      if (typeof inputs?.[k] === "number" && Number.isFinite(inputs[k])) {
        h = inputs[k];
        break;
      }
    }

    if (w && h) return { width: Math.floor(w), height: Math.floor(h) };
  }

  return null;
}

function applyOtgPlaceholders(
  graph: any,
  opts: { positive?: string; negative?: string; inputImages?: string[] }
) {
  if (!graph || typeof graph !== "object") return;

  const positive = String(opts.positive ?? "");
  const negative = String(opts.negative ?? "");
  const inputImages = Array.isArray(opts.inputImages) ? opts.inputImages.map(String) : [];

  let nextImgIdx = 0;

  const replaceInValue = (v: any): any => {
    if (typeof v === "string") {
      if (v === "__OTG_POSITIVE_PROMPT__") return positive;
      if (v === "__OTG_NEGATIVE_PROMPT__") return negative;

      const m = v.match(/^__OTG_INPUT_IMAGE(?:_(\d+))?__$/);
      if (m) {
        const idx = m[1] ? Math.max(0, Number(m[1]) - 1) : nextImgIdx++;
        return inputImages[idx] ?? v;
      }

      const m2 = v.match(/^otg__INPUT_(\d+)\.png$/i);
      if (m2) {
        const idx = Math.max(0, Number(m2[1]) - 1);
        return inputImages[idx] ?? v;
      }

      return v;
    }

    if (Array.isArray(v)) return v.map(replaceInValue);

    if (v && typeof v === "object") {
      const out: any = Array.isArray(v) ? [] : {};
      for (const [k, vv] of Object.entries(v)) out[k] = replaceInValue(vv);
      return out;
    }

    return v;
  };

  for (const node of Object.values(graph) as any[]) {
    if (!node?.inputs || typeof node.inputs !== "object") continue;
    for (const [k, v] of Object.entries(node.inputs)) {
      (node.inputs as any)[k] = replaceInValue(v);
    }
  }
}

function sanitizeUploadFilename(name: string) {
  const raw = String(name || "").trim();
  const base = raw.split(/[\\/]+/).pop() || "upload.bin";
  return base.replace(/[^a-zA-Z0-9._() -]/g, "_").slice(0, 180) || "upload.bin";
}

// OTG_PRODUCTION_ANIMATE_WORKFLOW_FILE_V19_START
function sanitizeWorkflowFileCandidate(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const normalized = value.split(String.fromCharCode(92)).join("/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) return "";
  if (normalized.split("/").some((part) => part === "..")) return "";
  if (!/\.json$/i.test(normalized)) return "";
  return normalized;
}

function resolvePostedWorkflowFile(raw: unknown) {
  const requested = sanitizeWorkflowFileCandidate(raw);
  if (!requested) return null;

  const cwd = path.resolve(process.cwd());
  const fileName = path.basename(requested);
  const candidates = [
    path.resolve(cwd, requested),
    path.resolve(cwd, "workflows", "production", fileName),
    path.resolve(cwd, "app", "workflows", "production", fileName),
    path.resolve(cwd, "public", "workflows", "production", fileName),
  ];

  for (const candidate of Array.from(new Set(candidates))) {
    const resolved = path.resolve(candidate);
    if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) continue;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }

  return null;
}

function loadPostedWorkflowJson(workflowFileRaw: unknown) {
  const resolved = resolvePostedWorkflowFile(workflowFileRaw);
  if (!resolved) {
    return {
      ok: false as const,
      status: 404,
      error: `Workflow file not found: ${String(workflowFileRaw || "").trim()}`,
      filePath: null as string | null,
    };
  }

  try {
    const json = JSON.parse(fs.readFileSync(resolved, "utf8"));
    return { ok: true as const, json, filePath: resolved };
  } catch (e: any) {
    return {
      ok: false as const,
      status: 400,
      error: `Could not read workflow file: ${String(e?.message || e)}`,
      filePath: resolved,
    };
  }
}
// OTG_PRODUCTION_ANIMATE_WORKFLOW_FILE_V19_END

// OTG_PRODUCTION_ANIMATE_FORCE_WORKFLOW_FILE_V20_START
function productionAnimateWorkflowFileForBody(body: any) {
  const explicitWorkflowId = String(body?.workflowId || body?.preset || body?.id || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/\.json$/i, "")
    .toLowerCase();

  // The Generate page posts this preset together with the legacy
  // requestKind=production-default-image-to-video hint. The explicit preset
  // owns the graph identity; the legacy hint must not replace it with the
  // unrelated workflows/production graph.
  if (explicitWorkflowId === "presets/create a video from images") {
    return "";
  }

  const hay = [
    body?.workflowId,
    body?.preset,
    body?.id,
    body?.workflowFile,
    body?.workflowPath,
    body?.workflowJsonPath,
    body?.workflowPresetPath,
    body?.workflowLabel,
    body?.label,
    body?.requestKind,
    body?.workflowSource,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  if (
    hay.includes("production/reference-video-gguf-voice-actor") ||
    hay.includes("production-reference-video-gguf-voice-actor") ||
    hay.includes("reference-to-video-gguf-voice-actor") ||
    hay.includes("reference video gguf voice actor") ||
    hay.includes("ltx reference gguf voice actor")
  ) {
    return "production-reference-video-gguf-voice-actor.json";
  }

  if (
    hay.includes("production/reference-video-gguf") ||
    hay.includes("production-reference-video-gguf") ||
    hay.includes("reference-to-video-gguf") ||
    hay.includes("reference video gguf") ||
    hay.includes("production/reference-video-gguf-test") ||
    hay.includes("production-reference-video-gguf-test") ||
    hay.includes("reference-to-video-gguf-test") ||
    hay.includes("reference video gguf test") ||
    hay.includes("ltx reference gguf")
  ) {
    return "production-reference-video-gguf.json";
  }

  if (
    hay.includes("production/lipsync-ltx23-1-1") ||
    hay.includes("production-lipsync") ||
    hay.includes("production lipsync") ||
    hay.includes("production-lip-sync") ||
    hay.includes("production voice actor") ||
    hay.includes("voice-actor-input") ||
    hay.includes("production-lipsync-video") ||
    hay.includes("production-lipsync-first-last-video") ||
    hay.includes("production-lipsync-image-to-video") ||
    hay.includes("voiceactorbasemode")
  ) {
    return "production-lipsync.json";
  }

  if (
    hay.includes("production/first-frame-last-frame-ltx23-1-1") ||
    hay.includes("production-first-frame-last-frame") ||
    hay.includes("production first frame last frame") ||
    hay.includes("production-first-last-frame-video") ||
    hay.includes("first-frame-last-frame")
  ) {
    return "production-first-frame-last-frame.json";
  }

  if (
    hay.includes("production/image-to-video-ltx23-1-1") ||
    hay.includes("production-image-to-video") ||
    hay.includes("production image to video") ||
    hay.includes("production-default-image-to-video")
  ) {
    return "production-image-to-video.json";
  }

  return "";
}
// OTG_PRODUCTION_ANIMATE_FORCE_WORKFLOW_FILE_V20_END
// OTG_COMFY_AUDIO_UPLOAD_FIX: Upload audio through ComfyUI input upload handling.
// Standard ComfyUI commonly accepts files through /upload/image with the "image" field,
// even when the uploaded file is audio for a LoadAudio node.
function buildComfyUploadFormData(file: File, fieldName: "image" | "audio") {
  const fd = new FormData();
  const safeName = sanitizeUploadFilename(file.name || ("otg_upload_" + Date.now()));
  fd.append(fieldName, file, safeName);
  fd.append("overwrite", "true");
  fd.append("type", "input");
  return fd;
}

async function tryComfyUploadEndpoint(
  comfyBaseUrl: string,
  urlPath: string,
  file: File,
  fieldName: "image" | "audio"
) {
  const res = await fetch(comfyBaseUrl + urlPath, {
    method: "POST",
    body: buildComfyUploadFormData(file, fieldName),
  });

  const responseText = await res.text();

  if (!res.ok) {
    return { ok: false as const, status: res.status, text: responseText };
  }

  let json = null;
  try {
    json = JSON.parse(responseText);
  } catch {
    json = null;
  }

  const name = json?.name || json?.filename;
  if (!name) {
    return { ok: false as const, status: res.status, text: responseText };
  }

  const rawSubfolder = json?.subfolder ? String(json.subfolder) : "";
  const subfolder = rawSubfolder
    .split(String.fromCharCode(92))
    .join("/")
    .split("/")
    .filter(Boolean)
    .join("/");

  return {
    ok: true as const,
    name: subfolder ? subfolder + "/" + String(name) : String(name),
  };
}

async function uploadFormFileToComfy(
  file: File,
  comfyBaseUrl: string,
  fieldName: "image" | "audio" = "image"
) {
  const kind = fieldName === "audio" ? "audio" : "image";

  const attempts: Array<{ path: string; field: "image" | "audio" }> =
    kind === "audio"
      ? [
          { path: "/upload/image", field: "image" },
          { path: "/upload/audio", field: "audio" },
          { path: "/upload/audio", field: "image" },
          { path: "/upload/image", field: "audio" },
        ]
      : [{ path: "/upload/image", field: "image" }];

  const failures: string[] = [];

  for (const attempt of attempts) {
    const result = await tryComfyUploadEndpoint(comfyBaseUrl, attempt.path, file, attempt.field);
    if (result.ok) return result.name;

    failures.push(
      attempt.path +
        " field=" +
        attempt.field +
        " status=" +
        result.status +
        " body=" +
        String(result.text || "").slice(0, 180)
    );
  }

  throw new Error("Comfy upload failed for " + kind + ". " + failures.join(" | "));
}

async function normalizeProductionAnimateImageForComfyV36BPU35(
  file: File,
  options: {
    suffix?: string;
    flattenAlpha?: boolean;
    maxWidth?: number;
    maxHeight?: number;
  } = {}
) {
  const input = Buffer.from(await file.arrayBuffer());
  const safeBase = path.basename(String(file.name || "production-animate-image.png")).replace(/\.[^.]+$/, "");
  const safeName =
    (safeBase.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "production-animate-image") +
    (options.suffix || "_otg_png") +
    ".png";

  let pipeline = sharp(input, { animated: false }).rotate();
  if (options.maxWidth || options.maxHeight) {
    pipeline = pipeline.resize({
      width: options.maxWidth,
      height: options.maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  if (options.flattenAlpha) {
    pipeline = pipeline.flatten({ background: { r: 0, g: 0, b: 0 } }).removeAlpha();
  }
  const output = await pipeline.png().toBuffer();
  const outputArrayBuffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;

  return new File([outputArrayBuffer], safeName, { type: "image/png" });
}

async function normalizeProductionReferenceVideoImageForComfyV36BPU37(file: File, slot: "imageA" | "imageB") {
  return normalizeProductionAnimateImageForComfyV36BPU35(file, {
    suffix: "_reference_rgb",
    flattenAlpha: true,
    maxWidth: slot === "imageB" ? 768 : 1280,
    maxHeight: slot === "imageB" ? 768 : 720,
  });
}

async function uploadServerImagePathToComfy(rawPath: string, comfyBaseUrl: string) {
  const resolved = path.resolve(String(rawPath || ""));
  const dataRoot = path.resolve(OTG_DATA_DIR);

  if (!resolved.startsWith(dataRoot + path.sep)) {
    throw new Error("Storyboard source image path is outside the OTG data directory.");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("Storyboard source image file was not found.");
  }

  const ext = path.extname(resolved).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) {
    throw new Error("Storyboard source file must be an image.");
  }

  const bytes = fs.readFileSync(resolved);
  const file = new File([bytes], path.basename(resolved));
  return uploadFormFileToComfy(file, comfyBaseUrl, "image");
}
function setNodeIfPresent(graph: any, nodeId: string, patch: Record<string, any>) {
  if (!graph || typeof graph !== "object") return;
  const node = graph?.[nodeId];
  if (!node?.inputs || typeof node.inputs !== "object") return;
  for (const [k, v] of Object.entries(patch)) {
    node.inputs[k] = v;
  }
}


async function peekWorkflowDescriptor(req: NextRequest) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  if (!ct.includes("multipart/form-data")) {
    try {
      const body = await req.clone().json();
      const otgGeneralGallerySuppressedV36BP3F_body = otgApplyNoGeneralGalleryPolicyToRecordV36BP3F(body as Record<string, unknown>);
      return {
        preset: String(body?.preset || body?.workflowId || body?.id || "").trim(),
        label: String(body?.label || body?.workflowLabel || body?.workflowName || "").trim(),
        workflowId: String(body?.workflowId || body?.preset || body?.id || "").trim(),
        workflowLabel: String(body?.workflowLabel || body?.label || body?.workflowName || "").trim(),
        requestKind: String(body?.requestKind || body?.sourceType || "").trim(),
        mediaType: String(body?.mediaType || body?.outputType || "").trim(),
        mode: String(body?.mode || body?.workflowMode || "").trim(),
        videoLoras: parsePostedVideoLoras(body?.videoLoras),
      };
    } catch {
      return { preset: "", label: "", workflowId: "", workflowLabel: "", requestKind: "", mediaType: "", mode: "", videoLoras: null };
    }
  }

  try {
    const fd = await req.clone().formData();
    const otgGeneralGallerySuppressedV36BP3F_fd = fd ? otgApplyNoGeneralGalleryPolicyToFormDataV36BP3F(fd) : false;
    return {
      preset: String(fd.get("workflowId") || fd.get("preset") || "").trim(),
      label: String(fd.get("label") || fd.get("workflowLabel") || fd.get("workflowName") || "").trim(),
      workflowId: String(fd.get("workflowId") || fd.get("preset") || "").trim(),
      workflowLabel: String(fd.get("workflowLabel") || fd.get("label") || fd.get("workflowName") || "").trim(),
      requestKind: String(fd.get("requestKind") || fd.get("sourceType") || "").trim(),
      mediaType: String(fd.get("mediaType") || fd.get("outputType") || "").trim(),
      mode: String(fd.get("mode") || fd.get("workflowMode") || "").trim(),
      videoLoras: parsePostedVideoLoras(fd.get("videoLoras")),
    };
  } catch {
    return { preset: "", label: "", workflowId: "", workflowLabel: "", requestKind: "", mediaType: "", mode: "", videoLoras: null };
  }
}

function parsePostedVideoLoras(value: unknown) {
  if (Array.isArray(value) || value === null || value === undefined) return value;
  if (typeof value !== "string" || !value.trim()) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function workflowKey(body: any) {
  const id = String(body?.preset || body?.workflowId || body?.id || "").trim().toLowerCase();
  const label = String(body?.label || body?.workflowLabel || body?.workflowName || "").trim().toLowerCase();
  return `${id} ${label}`.trim();
}

// OTG_VIDEO_IMAGES_RUNTIME_BINDING_V1
function assertCreateVideoFromImagesRuntimeBindingV1(
  graph: Record<string, any>,
  body: Record<string, any>,
  imageA: string | null
) {
  const workflowId = String(body?.workflowId || body?.preset || "").trim();
  if (workflowId.toLowerCase() !== "presets/create a video from images") return null;

  if (!imageA) {
    throw new Error("Create a Video from Images requires one uploaded starter image.");
  }

  const loadImageNodeIds = sortedNodeIds(graph).filter(
    (nodeId) => String(graph?.[nodeId]?.class_type || "") === "LoadImage"
  );
  if (loadImageNodeIds.length !== 1 || loadImageNodeIds[0] !== "187") {
    throw new Error(
      `Create a Video from Images workflow contract mismatch: expected only LoadImage node 187, found ${loadImageNodeIds.join(", ") || "none"}.`
    );
  }

  const actualImage = String(graph?.["187"]?.inputs?.image || "");
  if (actualImage !== imageA) {
    throw new Error("Create a Video from Images starter image binding failed at LoadImage node 187.");
  }

  const internalLoras = [
    {
      nodeId: "287",
      slot: "lora_1",
      filename: String(graph?.["287"]?.inputs?.lora_1?.lora || ""),
      expected: "Ltx2.3-Licon-VBVR-I2V-96000-R32.safetensors",
    },
    {
      nodeId: "287",
      slot: "lora_2",
      filename: String(graph?.["287"]?.inputs?.lora_2?.lora || ""),
      expected: "LTX2.3-IC-LORA-Dual-Character.safetensors",
    },
    {
      nodeId: "453",
      slot: "lora_name",
      filename: String(graph?.["453"]?.inputs?.lora_name || ""),
      expected: "ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
    },
  ];
  const mismatchedLora = internalLoras.find((item) => item.filename !== item.expected);
  if (mismatchedLora) {
    throw new Error(
      `Create a Video from Images internal LoRA contract mismatch at node ${mismatchedLora.nodeId}.${mismatchedLora.slot}.`
    );
  }

  return {
    workflowId,
    starterImageNodeId: "187",
    starterImage: imageA,
    loadImageNodeIds,
    internalLoras: internalLoras.map(({ nodeId, slot, filename }) => ({ nodeId, slot, filename })),
  };
}

function isProductionAnimateBranchSpecificTimingWorkflowV36BPU31(body: any) {
  const productionWorkflowFile = productionAnimateWorkflowFileForBody(body);
  return (
    productionWorkflowFile === "production-image-to-video.json" ||
    productionWorkflowFile === "production-first-frame-last-frame.json" ||
    productionWorkflowFile === "production-lipsync.json" ||
    productionWorkflowFile === "production-reference-video-gguf.json" ||
    productionWorkflowFile === "production-reference-video-gguf-voice-actor.json"
  );
}

const CHARACTER_CARD_WORKFLOW_ID_V36BPR4 = "presets/character_card_8_angles_low_angle";

function isCharacterCardRequestV36BPR4(body: any) {
  const text = [
    body?.workflowId,
    body?.preset,
    body?.requestKind,
    body?.sourceType,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  return text.includes(CHARACTER_CARD_WORKFLOW_ID_V36BPR4) || text.includes("characters-8-angle-card");
}

function forceCharacterCardWorkflowIdentityV36BPR4(body: any) {
  if (!body || typeof body !== "object" || !isCharacterCardRequestV36BPR4(body)) return false;

  body.workflowId = CHARACTER_CARD_WORKFLOW_ID_V36BPR4;
  body.preset = CHARACTER_CARD_WORKFLOW_ID_V36BPR4;
  body.workflowFile = "";
  body.workflowPath = "";
  body.workflowJsonPath = "";
  body.workflowPresetPath = "";
  body.characterGeneratorOption = "";
  body.characterGeneratorLabel = "";
  body.prompt = "";
  body.positivePrompt = "";
  body.negativePrompt = "";
  body.neg = "";
  body.promptNodeId = "";
  body.positivePromptNodeId = "";
  body.negativePromptNodeId = "";
  body.promptNodeIds = [];
  body.positiveNodeIds = [];
  body.negativeNodeIds = [];

  return true;
}

function ltxFramesFromSeconds(secondsRaw: any, graph?: any) {
  const seconds = clampGenerateDurationSeconds(secondsRaw);
  const fps = Math.max(1, Math.min(120, Math.floor(inferFps(graph)) || 24));
  return seconds * fps + 1;
}

function sortedNodeIds(graph: any): string[] {
  return Object.keys(graph || {}).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    const aNum = Number.isFinite(an);
    const bNum = Number.isFinite(bn);
    if (aNum && bNum) return an - bn;
    if (aNum) return -1;
    if (bNum) return 1;
    return a.localeCompare(b);
  });
}

function setFirstLoadImageNode(graph: any, imageName: string): string | null {
  if (!graph || typeof graph !== "object" || !imageName) return null;

  for (const id of sortedNodeIds(graph)) {
    const node = graph?.[id];
    if (!node?.inputs || typeof node.inputs !== "object") continue;
    if (String(node?.class_type || "") !== "LoadImage") continue;
    if (typeof node.inputs.image !== "string") continue;

    node.inputs.image = imageName;
    return id;
  }

  return null;
}

function isProductionQwenStoryboardWorkflow(body: any, otgMeta?: any) {
  const hay = [
    body?.workflowId,
    body?.preset,
    body?.id,
    body?.workflowLabel,
    body?.label,
    otgMeta?.label,
    otgMeta?.description,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return hay.includes("qwen_image_edit_2511_storyboard") || hay.includes("production qwen 2511 storyboard");
}

function applyQwenStoryboardCharacterReferences(graph: any, body: any, otgMeta?: any) {
  const emptyMapping = {
    usesDeclaredReferenceInputs: false,
    applied: 0,
    maxSlots: 0,
    loadNodeIds: [] as string[],
    scaleNodeIds: [] as string[],
    encodeNodeIds: [] as string[],
    inputImages: [] as string[],
  };

  if (!graph || typeof graph !== "object") return emptyMapping;
  if (!isProductionQwenStoryboardWorkflow(body, otgMeta)) return emptyMapping;

  const inputImagesRaw = Array.isArray(body?.inputImages)
    ? body.inputImages.map((value: any) => String(value || "").trim()).filter(Boolean)
    : [];
  const seenImages = new Set<string>();
  const inputImages = inputImagesRaw
    .filter((name: string) => {
      const key = name.toLowerCase();
      if (seenImages.has(key)) return false;
      seenImages.add(key);
      return true;
    })
    .slice(0, 5);

  const loadNodeIds = Array.isArray(otgMeta?.characterReferenceLoadNodeIds)
    ? otgMeta.characterReferenceLoadNodeIds.map(String)
    : ["28", "21", "14", "39", "38"];
  const scaleNodeIds = Array.isArray(otgMeta?.characterReferenceScaleNodeIds)
    ? otgMeta.characterReferenceScaleNodeIds.map(String)
    : ["15", "16", "17", "40", "41"];
  const encodeNodeIds = Array.isArray(otgMeta?.characterReferenceEncodeNodeIds)
    ? otgMeta.characterReferenceEncodeNodeIds.map(String)
    : ["36", "37"];

  const usesDeclaredReferenceInputs = loadNodeIds.length > 0 && scaleNodeIds.length > 0 && encodeNodeIds.length > 0;
  if (!usesDeclaredReferenceInputs) return emptyMapping;

  const maxRefs = Math.min(5, loadNodeIds.length, scaleNodeIds.length);
  const activeCount = Math.min(maxRefs, inputImages.length);
  const activeScaleNodeIds = scaleNodeIds.slice(0, activeCount);

  for (let i = 0; i < maxRefs; i++) {
    const loadNodeId = loadNodeIds[i];
    const scaleNodeId = scaleNodeIds[i];
    if (i < activeCount) {
      setNodeIfPresent(graph, loadNodeId, { image: inputImages[i] });
      setNodeIfPresent(graph, scaleNodeId, { image: [loadNodeId, 0] });
    } else {
      delete graph?.[scaleNodeId];
      delete graph?.[loadNodeId];
    }
  }

  const qwenEncodeNodeIds = Array.from(
    new Set([
      ...encodeNodeIds,
      ...Object.entries<any>(graph)
        .filter(([, node]) =>
          ["TextEncodeQwenImageEditPlus_lrzjason", "TextEncodeQwenImageEditPlus5_OTG"].includes(String(node?.class_type || ""))
        )
        .map(([id]) => String(id)),
    ])
  );

  for (const encodeNodeId of qwenEncodeNodeIds) {
    const node = graph?.[encodeNodeId];
    if (!node?.inputs || typeof node.inputs !== "object") continue;
    for (let i = 0; i < maxRefs; i++) {
      const key = `image${i + 1}`;
      if (i < activeCount) {
        node.inputs[key] = [activeScaleNodeIds[i], 0];
      } else {
        delete node.inputs[key];
      }
    }
  }

  return {
    usesDeclaredReferenceInputs: true,
    applied: activeCount,
    maxSlots: maxRefs,
    loadNodeIds,
    scaleNodeIds,
    encodeNodeIds,
    inputImages: inputImages.slice(0, activeCount),
  };
}

function setFirstLoadVideoNode(graph: any, videoName: string): string | null {
  if (!graph || typeof graph !== "object" || !videoName) return null;

  for (const id of sortedNodeIds(graph)) {
    const node = graph?.[id];
    if (!node?.inputs || typeof node.inputs !== "object") continue;

    const classType = String(node?.class_type || "");
    if (!/loadvideo|vhs_loadvideo/i.test(classType)) continue;
    if (typeof node.inputs.video !== "string") continue;

    node.inputs.video = videoName;
    return id;
  }

  return null;
}

function setFirstLoadAudioNode(graph: any, audioName: string): string | null {
  if (!graph || typeof graph !== "object" || !audioName) return null;

  for (const id of sortedNodeIds(graph)) {
    const node = graph?.[id];
    if (!node?.inputs || typeof node.inputs !== "object") continue;

    const classType = String(node?.class_type || "");
    if (!/audio/i.test(classType) && typeof node.inputs.audio !== "string") continue;
    if (typeof node.inputs.audio !== "string") continue;

    node.inputs.audio = audioName;
    return id;
  }

  return null;
}

function applyLtx23Overrides(
  graph: any,
  body: any,
  assets: {
    imageA?: string | null;
    imageB?: string | null;
    videoA?: string | null;
    audioA?: string | null;
  }
) {
  const key = workflowKey(body);
  const seconds = clampGenerateDurationSeconds(body?.durationSeconds);
  const frames = ltxFramesFromSeconds(seconds, graph);

  const hasNode = (nodeId: string) => {
    const node = graph?.[nodeId];
    return !!node?.inputs && typeof node.inputs === "object";
  };

  const nodeClassType = (nodeId: string) => String(graph?.[nodeId]?.class_type || "").trim();

  const characterCardContext = [
    body?.workflowId,
    body?.preset,
    body?.requestKind,
    body?.sourceType,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  if (
    characterCardContext.includes("presets/character_card_8_angles_low_angle") ||
    characterCardContext.includes("characters-8-angle-card")
  ) {
    if (!assets.imageA) {
      throw new Error("Character Card workflow requires a current uploaded source image from imageA/imageAPath.");
    }

    if (!hasNode("25") || nodeClassType("25") !== "LoadImage") {
      throw new Error("Character Card workflow contract mismatch: node 25 must exist and be LoadImage.");
    }

    if (!hasNode("439") || nodeClassType("439") !== "SaveImage") {
      throw new Error("Character Card workflow contract mismatch: node 439 must exist and be SaveImage.");
    }

    const requestedPrefix = String(
      body?.filenamePrefix ||
        body?.filename_prefix ||
        body?.title ||
        `Character Card_${Date.now().toString(36)}`
    )
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "_");
    const filenamePrefix = requestedPrefix || `Character Card_${Date.now().toString(36)}`;

    setNodeIfPresent(graph, "25", { image: assets.imageA });
    // v36bpt5: preserve uploaded Character Card workflow exactly; do not override node 439 filename_prefix.
    return;
  }


  const getLtx23RequestedSeconds = () => {
    const raw =
      body?.durationSeconds ??
      body?.duration ??
      body?.seconds ??
      body?.durationSec ??
      body?.clipSeconds ??
      5;

    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 5;

    // Only supported app durations. Snap close values to remove 24fps/4.8s drift.
    if (n <= 7.5) return 5;
    if (n <= 12.5) return 10;
    return 15;
  };

  const getLtx23FrameCount = () => getLtx23RequestedSeconds() * 25 + 1;

  const applyProductionLtx23NativeVideoDefaultsV36BPU31 = () => {
    setNodeIfPresent(graph, "389:825", { value: 25 });
    setNodeIfPresent(graph, "389:828", { value: 1280 });
    setNodeIfPresent(graph, "389:830", { value: 720 });
    setNodeIfPresent(graph, "389:1928:856:421", { length: 9 });
  };

  const removeProductionAnimateOutputOnlyHelpersV36BPU46 = (options: { keepAudio: boolean }) => {
    delete graph["175"];
    delete graph["1887:1701"];

    if (!options.keepAudio && graph?.["172"]?.inputs && typeof graph["172"].inputs === "object") {
      delete graph["172"].inputs.audio;
    }
  };

  const ensureProductionLtx23OutputAudioV36BPU47 = () => {
    if (hasNode("172") && hasNode("1693:1690")) {
      setNodeIfPresent(graph, "172", { audio: ["1693:1690", 0] });
    }
  };

  const setPromptPair = () => {
    const positiveText = String(body?.positivePrompt || body?.prompt || "");
  otgApplyQwenNextScenePromptFromRequestV36BO4(graph, body);
    const negativeText = String(body?.negativePrompt || body?.neg || "");

    // Current LTX 2.3 v1.1 app graphs use 767/109.
    setNodeIfPresent(graph, "767", { value: positiveText });
    setNodeIfPresent(graph, "109", { text: negativeText });

    // Older/alternate app graphs still use these nodes. Keep them for compatibility.
    setNodeIfPresent(graph, "121", { text: positiveText });
    setNodeIfPresent(graph, "593", { text: negativeText });
    setNodeIfPresent(graph, "110", { text: negativeText });

    // Anime image graph uses Qwen/Anima nodes.
    setNodeIfPresent(graph, "67", { text: positiveText });
    setNodeIfPresent(graph, "65", { text: negativeText });
  };
  if (
    key.includes("production/lipsync-ltx23-1-1") ||
    key.includes("production-lipsync") ||
    key.includes("production lip sync") ||
    key.includes("production-lip-sync") ||
    key.includes("production voice actor") ||
    key.includes("voice actor input") ||
    key.includes("production-lipsync-video") ||
    key.includes("production-lipsync-first-last-video") ||
    key.includes("production-lipsync-image-to-video")
  ) {
    const positiveText = String(body?.positivePrompt || body?.prompt || "");
  otgApplyQwenNextScenePromptFromRequestV36BO4(graph, body);
    const seedValue = Number(body?.seed || body?.noiseSeed || Date.now());

    if (!assets.imageA) {
      throw new Error("Missing first frame image upload for voice actor lip sync: imageA");
    }
    if (!assets.audioA) {
      throw new Error("Missing voice actor audio upload for voice actor lip sync: audioA");
    }

    const isFastLtx2VoiceActorGraphV36BPU50 =
      graph?.["75"]?.class_type === "SaveVideo" &&
      graph?.["122"]?.class_type === "CreateVideo" &&
      graph?.["149"]?.class_type === "LoadImage" &&
      graph?.["1885"]?.class_type === "LoadAudio" &&
      graph?.["242"]?.class_type === "LTXVAudioVAEEncode" &&
      graph?.["112"]?.class_type === "PrimitiveInt";

    if (isFastLtx2VoiceActorGraphV36BPU50) {
      const negativeText = String(body?.negativePrompt || body?.neg || "");
      const requestedSeconds = getLtx23RequestedSeconds();
      const frameRate = 24;
      const lengthFrames = Math.max(1, Math.floor(requestedSeconds * frameRate) + 1);
      const safeSeed = Number.isFinite(seedValue) ? Math.floor(seedValue) : Date.now();
      const outputPrefix =
        String(body?.outputPrefix || body?.filenamePrefix || "video/Production-LipSync").trim() ||
        "video/Production-LipSync";
      const hasLastFrameNode = graph?.["1894"]?.class_type === "LoadImage";
      const lastFrameImage = assets.imageB || assets.imageA;

      setNodeIfPresent(graph, "149", { image: assets.imageA });
      if (hasLastFrameNode) {
        setNodeIfPresent(graph, "1894", { image: lastFrameImage });
      }
      setNodeIfPresent(graph, "153", { image: ["149", 0] });
      setNodeIfPresent(graph, "154", { image: hasLastFrameNode ? ["1894", 0] : ["149", 0] });
      setNodeIfPresent(graph, "121", { text: positiveText });
      setNodeIfPresent(graph, "110", { text: negativeText });
      setNodeIfPresent(graph, "112", { value: lengthFrames });
      setNodeIfPresent(graph, "129", { value: frameRate });
      setNodeIfPresent(graph, "130", { value: frameRate });
      setNodeIfPresent(graph, "114", { noise_seed: safeSeed });
      setNodeIfPresent(graph, "115", { noise_seed: safeSeed + 1 });
      setNodeIfPresent(graph, "1885", { audio: assets.audioA });
      setNodeIfPresent(graph, "1887:1704", { value: requestedSeconds });
      setNodeIfPresent(graph, "242", { audio: ["1885", 0], audio_vae: ["200", 0] });
      setNodeIfPresent(graph, "109", { audio_latent: ["242", 0] });
      setNodeIfPresent(graph, "122", { audio: ["1885", 0] });
      setNodeIfPresent(graph, "75", { filename_prefix: outputPrefix, format: "mp4", codec: "auto" });
      return;
    }

    // Voice Actor Input supports both:
    // - normal image-to-video: imageB is absent, so last-frame falls back to imageA
    // - first-frame/last-frame: imageB is present and becomes the workflow last frame
    setNodeIfPresent(graph, "1896", { image: assets.imageA });
    setNodeIfPresent(graph, "1894", { image: assets.imageB || assets.imageA });
    setNodeIfPresent(graph, "1879", { text: positiveText });
    setNodeIfPresent(graph, "1883", { value: true });
    setNodeIfPresent(graph, "1885", { audio: assets.audioA });
    setNodeIfPresent(graph, "1888", { audio: assets.audioA });
    setFirstLoadAudioNode(graph, assets.audioA);
    setNodeIfPresent(graph, "1887:1704", { value: getLtx23RequestedSeconds() });
    setNodeIfPresent(graph, "389:387", { value: getLtx23RequestedSeconds() });
    applyProductionLtx23NativeVideoDefaultsV36BPU31();
    removeProductionAnimateOutputOnlyHelpersV36BPU46({ keepAudio: true });
    ensureProductionLtx23OutputAudioV36BPU47();
    setNodeIfPresent(graph, "389:363", { noise_seed: Number.isFinite(seedValue) ? Math.floor(seedValue) : Date.now() });
    setNodeIfPresent(graph, "172", { filename_prefix: "video/Production-LipSync" });
    return;
  }

  if (
    key.includes("production/first-frame-last-frame-ltx23-1-1") ||
    key.includes("production-first-frame-last-frame") ||
    key.includes("production first frame last frame") ||
    key.includes("production-first-last-frame-video") ||
    key.includes("presets/create first image to last image video") ||
    key.includes("first image to last image") ||
    key.includes("first to last image")
  ) {
    const positiveText = String(body?.positivePrompt || body?.prompt || "");
  otgApplyQwenNextScenePromptFromRequestV36BO4(graph, body);
    const negativeText = String(body?.negativePrompt || body?.neg || "");
    const width = Number(body?.width || 1280);
    const height = Number(body?.height || 720);
    const seedValue = Number(body?.seed || body?.noiseSeed || Date.now());
    const ltx23FrameCount = getLtx23FrameCount();

    if (!assets.imageA) {
      throw new Error("Missing first frame image upload: imageA");
    }
    if (!assets.imageB) {
      throw new Error("Missing last frame image upload: imageB");
    }

    const isFastLtx2FirstLastWorkflowV36BPU49 =
      graph?.["75"]?.class_type === "SaveVideo" &&
      graph?.["122"]?.class_type === "CreateVideo" &&
      graph?.["149"]?.class_type === "LoadImage" &&
      graph?.["1894"]?.class_type === "LoadImage" &&
      graph?.["112"]?.class_type === "PrimitiveInt";

    if (isFastLtx2FirstLastWorkflowV36BPU49) {
      const requestedSeconds = getLtx23RequestedSeconds();
      const frameRate = 24;
      const lengthFrames = Math.max(1, Math.floor(requestedSeconds * frameRate) + 1);
      const outputPrefix = String(body?.outputPrefix || "video/Production-FirstLast").trim() || "video/Production-FirstLast";

      setNodeIfPresent(graph, "149", { image: assets.imageA });
      setNodeIfPresent(graph, "1894", { image: assets.imageB });
      setNodeIfPresent(graph, "153", { image: ["149", 0] });
      setNodeIfPresent(graph, "154", { image: ["1894", 0] });
      setNodeIfPresent(graph, "121", { text: positiveText });
      setNodeIfPresent(graph, "110", { text: negativeText });
      setNodeIfPresent(graph, "112", { value: lengthFrames });
      setNodeIfPresent(graph, "129", { value: frameRate });
      setNodeIfPresent(graph, "130", { value: frameRate });
      setNodeIfPresent(graph, "114", { noise_seed: Number.isFinite(seedValue) ? Math.floor(seedValue) : Date.now() });
      setNodeIfPresent(graph, "115", { noise_seed: Number.isFinite(seedValue) ? Math.floor(seedValue) + 1 : Date.now() + 1 });
      setNodeIfPresent(graph, "75", { filename_prefix: outputPrefix, format: "mp4", codec: "auto" });
      return;
    }

    // Current first-frame/last-frame LTX 2.3 v1.1 graph.
    setNodeIfPresent(graph, "187", { image: assets.imageA });
    setNodeIfPresent(graph, "411", { image: assets.imageB });
    setNodeIfPresent(graph, "767", { value: positiveText });
    setNodeIfPresent(graph, "109", { text: negativeText });
    setNodeIfPresent(graph, "1175", { value: ltx23FrameCount });
    setNodeIfPresent(graph, "126", { value: 25 });
    setNodeIfPresent(graph, "199", { value: Number.isFinite(width) ? width : 1280 });
    setNodeIfPresent(graph, "200", { value: Number.isFinite(height) ? height : 720 });
    setNodeIfPresent(graph, "818", { seed: Number.isFinite(seedValue) ? Math.floor(seedValue) : Date.now() });
    setNodeIfPresent(graph, "813", { seed: Number.isFinite(seedValue) ? Math.floor(seedValue) + 1 : Date.now() + 1 });
    setNodeIfPresent(graph, "180", { filename_prefix: "video/ltx2.3_flf2v_webapp" });

    // Production uploaded first-frame/last-frame LTX 2.3.1 workflow.
    setNodeIfPresent(graph, "1896", { image: assets.imageA });
    setNodeIfPresent(graph, "1894", { image: assets.imageB });
    setNodeIfPresent(graph, "1879", { text: positiveText });
    setNodeIfPresent(graph, "389:387", { value: getLtx23RequestedSeconds() });
    applyProductionLtx23NativeVideoDefaultsV36BPU31();
    removeProductionAnimateOutputOnlyHelpersV36BPU46({ keepAudio: true });
    ensureProductionLtx23OutputAudioV36BPU47();
    setNodeIfPresent(graph, "389:363", { noise_seed: Number.isFinite(seedValue) ? Math.floor(seedValue) : Date.now() });
    setNodeIfPresent(graph, "172", { filename_prefix: "video/Production-FirstLast" });

    // Older/alternate first-last graphs.
    setNodeIfPresent(graph, "31", { image: assets.imageA });
    setNodeIfPresent(graph, "39", { image: assets.imageB });
    setNodeIfPresent(graph, "222", { text: positiveText });
    setNodeIfPresent(graph, "217", { text: negativeText });
    setNodeIfPresent(graph, "198", { value: getLtx23RequestedSeconds() });
    setNodeIfPresent(graph, "205", { value: 25 });
    setNodeIfPresent(graph, "215", { value: Number.isFinite(width) ? width : 1280 });
    setNodeIfPresent(graph, "216", { value: Number.isFinite(height) ? height : 720 });
    setNodeIfPresent(graph, "196", { noise_seed: Number.isFinite(seedValue) ? Math.floor(seedValue) : Date.now() });
    setNodeIfPresent(graph, "68", { filename_prefix: "video/ltx2.3_flf2v_webapp", format: "mp4", codec: "auto" });
    return;
  }
  if (
    key.includes("presets/create prompt relay image video") ||
    key.includes("prompt relay image video") ||
    key.includes("scene-controlled image video") ||
    key.includes("scene controlled image video")
  ) {
    const positiveText = String(body?.positivePrompt || body?.prompt || "");
  otgApplyQwenNextScenePromptFromRequestV36BO4(graph, body);
    const globalPrompt = String(body?.promptRelayGlobalPrompt || body?.globalPrompt || positiveText || "").trim();
    const localPrompts = String(body?.promptRelayLocalPrompts || body?.localPrompts || body?.smartPrompt || positiveText || "").trim();
    const negativeText = String(body?.negativePrompt || body?.neg || "");
    const width = Number(body?.width || 1280);
    const height = Number(body?.height || 720);
    const fps = 25;
    const seedValue = Number(body?.seed || body?.noiseSeed || Date.now());
    const relayEpsilon = Number(body?.promptRelayEpsilon || 0.001);

    if (!assets.imageA) {
      throw new Error("Missing Prompt Relay starter image upload: imageA");
    }
    if (!localPrompts) {
      throw new Error("Missing Prompt Relay beat prompts.");
    }

    setNodeIfPresent(graph, "149", { image: assets.imageA });
    setFirstLoadImageNode(graph, assets.imageA);
    setNodeIfPresent(graph, "605", {
      global_prompt: globalPrompt,
      local_prompts: localPrompts,
      segment_lengths: String(body?.promptRelaySegmentLengths || body?.segmentLengths || ""),
      epsilon: Number.isFinite(relayEpsilon) ? relayEpsilon : 0.001,
    });
    setNodeIfPresent(graph, "121", { text: globalPrompt || localPrompts });
    setNodeIfPresent(graph, "110", { text: negativeText });
    if (graph?.["112"]?.inputs && typeof graph["112"].inputs.value === "number") {
      setNodeIfPresent(graph, "112", { value: getLtx23FrameCount() });
    }
    setNodeIfPresent(graph, "1175", { value: getLtx23FrameCount() });
    setNodeIfPresent(graph, "126", { value: fps });
    setNodeIfPresent(graph, "129", { value: fps });
    setNodeIfPresent(graph, "130", { value: fps });
    setNodeIfPresent(graph, "241", {
      width: Number.isFinite(width) ? width : 1280,
      height: Number.isFinite(height) ? height : 720,
    });
    setNodeIfPresent(graph, "114", { noise_seed: Number.isFinite(seedValue) ? Math.floor(seedValue) : Date.now() });
    setNodeIfPresent(graph, "115", { noise_seed: Number.isFinite(seedValue) ? Math.floor(seedValue) + 1 : Date.now() + 1 });
    setNodeIfPresent(graph, "161", { filename_prefix: "LTXV 2.3 v1.1 prompt_relay" });
    return;
  }
  const applyLtx23V11TextToVideoDuration = () => {
    if (!hasNode("112")) return false;

    const ltx23Fps = 25;
    const ltx23FrameCount = getLtx23FrameCount();

    // Current LTX 2.3 v1.1 app graphs use 1175/126.
    setNodeIfPresent(graph, "1175", { value: ltx23FrameCount });
    setNodeIfPresent(graph, "126", { value: ltx23Fps });

    // Older/alternate graphs use 112 and 129/130. Only write 112 when it is a scalar frame node, not a sampler.
    if (graph?.["112"]?.inputs && typeof graph["112"].inputs.value === "number") {
      setNodeIfPresent(graph, "112", { value: ltx23FrameCount });
    }
    setNodeIfPresent(graph, "129", { value: ltx23Fps });
    setNodeIfPresent(graph, "130", { value: ltx23Fps });
    return true;
  };

  const applyLegacyLtxDuration = (videoNodeId: string, audioNodeId: string) => {
    let applied = false;
    if (hasNode(videoNodeId)) {
      setNodeIfPresent(graph, videoNodeId, { length: frames });
      applied = true;
    }
    if (hasNode(audioNodeId)) {
      setNodeIfPresent(graph, audioNodeId, { frames_number: frames });
      applied = true;
    }
    return applied;
  };

  const applySliderDuration = () => {
    if (!hasNode("196")) return false;
    setNodeIfPresent(graph, "196", { Xi: seconds, Xf: seconds });
    return true;
  };


  if (key.includes("presets/rtx sr upscaler video") || key.includes("upscale video (rtx sr)") || key.includes("rtx sr upscaler")) {
    if (assets.videoA) {
      setNodeIfPresent(graph, "2", { video: assets.videoA });
      setFirstLoadVideoNode(graph, assets.videoA);
    }
    return;
  }
  if (key.includes("presets/edit pictures") || key.includes("presets/edit picture")) {
    if (assets.imageA) {
      setNodeIfPresent(graph, "143", { image: assets.imageA });
      setFirstLoadImageNode(graph, assets.imageA);
    }
    return;
  }

  // OTG_CUSTOM_AUDIO_I2V_ROUTE: LTX 2.3 image-to-video with uploaded custom audio.
  if (
    key.includes("presets/create video with custom audio") ||
    key.includes("create video with custom audio") ||
    key.includes("custom audio image video") ||
    key.includes("image audio 2 video")
  ) {
    setPromptPair();

    const positiveText = String(body?.positivePrompt || body?.prompt || "");
  otgApplyQwenNextScenePromptFromRequestV36BO4(graph, body);
    const negativeText = String(body?.negativePrompt || body?.neg || "");
    const width = Number(body?.width || 1280);
    const height = Number(body?.height || 720);
    const seedValue = Number(body?.seed || body?.noiseSeed || Date.now());
    const ltx23FrameCount = getLtx23FrameCount();

    if (!assets.imageA) {
      throw new Error("Missing input image upload for custom audio video: imageA");
    }
    if (!assets.audioA) {
      throw new Error("Missing custom audio upload for custom audio video: audioA");
    }

    setNodeIfPresent(graph, "187", { image: assets.imageA });
    setFirstLoadImageNode(graph, assets.imageA);
    setNodeIfPresent(graph, "316", { audio: assets.audioA });
    setFirstLoadAudioNode(graph, assets.audioA);

    setNodeIfPresent(graph, "767", { value: positiveText });
    setNodeIfPresent(graph, "109", { text: negativeText });
    setNodeIfPresent(graph, "1175", { value: ltx23FrameCount });
    setNodeIfPresent(graph, "126", { value: 25 });
    setNodeIfPresent(graph, "199", { value: Number.isFinite(width) ? width : 1280 });
    setNodeIfPresent(graph, "200", { value: Number.isFinite(height) ? height : 720 });
    setNodeIfPresent(graph, "818", { seed: Number.isFinite(seedValue) ? Math.floor(seedValue) : Date.now() });
    setNodeIfPresent(graph, "813", { seed: Number.isFinite(seedValue) ? Math.floor(seedValue) + 1 : Date.now() + 1 });
    setNodeIfPresent(graph, "180", { filename_prefix: "video/ltx2.3_custom_audio_i2v_webapp" });
    return;
  }


  if (
    key.includes("production/reference-video-gguf-voice-actor") ||
    key.includes("production-reference-video-gguf-voice-actor") ||
    key.includes("reference-to-video-gguf-voice-actor") ||
    key.includes("reference video gguf voice actor") ||
    key.includes("production/reference-video-gguf-test") ||
    key.includes("production-reference-video-gguf-test") ||
    key.includes("production/reference-video-gguf") ||
    key.includes("production-reference-video-gguf") ||
    key.includes("reference-to-video-gguf") ||
    key.includes("reference video gguf") ||
    key.includes("reference-to-video-gguf-test") ||
    key.includes("reference video gguf test") ||
    key.includes("ltx reference gguf")
  ) {
    const positiveText = String(body?.positivePrompt || body?.prompt || "");
    const negativeText = String(body?.negativePrompt || "").trim();
    const seedValue = Number(body?.seed || body?.noiseSeed || Date.now());
    const usesVoiceActorAudio =
      key.includes("production/reference-video-gguf-voice-actor") ||
      key.includes("production-reference-video-gguf-voice-actor") ||
      key.includes("reference-to-video-gguf-voice-actor") ||
      key.includes("reference video gguf voice actor");
    const outputPrefix = String(body?.outputPrefix || (usesVoiceActorAudio ? "video/Production-Reference-GGUF-Voice-Actor" : "video/Production-Reference-GGUF")).trim() || (usesVoiceActorAudio ? "video/Production-Reference-GGUF-Voice-Actor" : "video/Production-Reference-GGUF");
    const requestedReferenceFramesRaw = Number(
      body?.referenceVideoFrameCount ??
        body?.frameCount ??
        body?.numFrames ??
        body?.totalFrames ??
        body?.targetFrames ??
        0
    );
    const requestedReferenceSeconds = Number(body?.durationSeconds ?? body?.seconds ?? body?.duration ?? 15);
    const referenceVideoFrameCount = clampFrames(
      Number.isFinite(requestedReferenceFramesRaw) && requestedReferenceFramesRaw > 0
        ? requestedReferenceFramesRaw
        : (Number.isFinite(requestedReferenceSeconds) && requestedReferenceSeconds > 0 ? Math.round(requestedReferenceSeconds * 25) : 375)
    ).frames;
    // GGUF reference-video parity: node 317 is the frame/latent count used by
    // the native workflow, not a 10x audio sample count.
    const referenceLatentFrameCount = referenceVideoFrameCount;

    if (!assets.imageA) {
      throw new Error("Missing GGUF reference-video background/current scene image upload: imageA");
    }
    if (!assets.imageB) {
      throw new Error("Missing GGUF reference-video character reference upload: imageB");
    }
    if (usesVoiceActorAudio && !assets.audioA) {
      throw new Error("Missing GGUF reference-video voice actor audio upload: audioA");
    }

    const isFastLtx2ReferenceGraphV36BPU51 =
      graph?.["75"]?.class_type === "SaveVideo" &&
      graph?.["122"]?.class_type === "CreateVideo" &&
      graph?.["149"]?.class_type === "LoadImage" &&
      graph?.["311"]?.class_type === "LoadImage" &&
      graph?.["312"]?.class_type === "LiconMSR" &&
      graph?.["314"]?.class_type === "LTXAddVideoICLoRAGuide" &&
      graph?.["112"]?.class_type === "PrimitiveInt";

    if (isFastLtx2ReferenceGraphV36BPU51) {
      const requestedSeconds = Number(body?.durationSeconds ?? body?.seconds ?? body?.duration ?? 15);
      const safeSeconds = Number.isFinite(requestedSeconds) && requestedSeconds > 0 ? requestedSeconds : 15;
      const frameRate = 24;
      const lengthFrames = Math.max(1, Math.floor(safeSeconds * frameRate) + 1);
      const safeSeed = Number.isFinite(seedValue) ? Math.floor(seedValue) : Date.now();

      setNodeIfPresent(graph, "149", { image: assets.imageA });
      setNodeIfPresent(graph, "311", { image: assets.imageB });
      setNodeIfPresent(graph, "241", { image: ["149", 0] });
      setNodeIfPresent(graph, "312", {
        "1": ["311", 0],
        background: ["149", 0],
        width: ["241", 1],
        height: ["241", 2],
        frame_count: 25,
      });
      setNodeIfPresent(graph, "314", {
        crop: "center",
        positive: ["107", 0],
        negative: ["107", 1],
        vae: ["198", 0],
        latent: ["153", 0],
        image: ["312", 0],
      });
      setNodeIfPresent(graph, "109", { video_latent: ["314", 2] });
      setNodeIfPresent(graph, "128", { positive: ["314", 0], negative: ["314", 1] });
      setNodeIfPresent(graph, "103", { positive: ["314", 0], negative: ["314", 1] });
      setNodeIfPresent(graph, "121", { text: positiveText });
      setNodeIfPresent(graph, "110", { text: negativeText });
      setNodeIfPresent(graph, "112", { value: lengthFrames });
      setNodeIfPresent(graph, "129", { value: frameRate });
      setNodeIfPresent(graph, "130", { value: frameRate });
      setNodeIfPresent(graph, "114", { noise_seed: safeSeed });
      setNodeIfPresent(graph, "115", { noise_seed: safeSeed + 1 });

      if (usesVoiceActorAudio) {
        if (!hasNode("1885") || !hasNode("242")) {
          throw new Error("Fast GGUF reference-video voice actor workflow contract mismatch: expected audio nodes 1885 and 242.");
        }
        setNodeIfPresent(graph, "1885", { audio: assets.audioA });
        setNodeIfPresent(graph, "242", { audio: ["1885", 0], audio_vae: ["200", 0] });
        setNodeIfPresent(graph, "109", { audio_latent: ["242", 0] });
        setNodeIfPresent(graph, "122", { audio: ["1885", 0] });
      } else {
        setNodeIfPresent(graph, "109", { audio_latent: ["171", 0] });
        setNodeIfPresent(graph, "122", { audio: ["127", 0] });
      }

      setNodeIfPresent(graph, "75", { filename_prefix: outputPrefix, format: "mp4", codec: "auto" });
      return;
    }

    if (!hasNode("240") || !hasNode("311") || !hasNode("312") || !hasNode("313") || !hasNode("314")) {
      throw new Error("GGUF reference-video workflow contract mismatch: expected nodes 240, 311, 312, 313, and 314.");
    }
    if (usesVoiceActorAudio && (!hasNode("242") || !hasNode("309"))) {
      throw new Error("GGUF reference-video voice actor workflow contract mismatch: expected audio nodes 242 and 309.");
    }

    // OTG_PRODUCTION_REFERENCE_GGUF_TEST_VALIDATION_FIX_V36BPU36:
    // Remove sample audio nodes from the source I2V graph. Comfy validates
    // disconnected nodes too, so a stale LoadAudio filename can reject the job.
    delete graph["248"];
    delete graph["249"];
    delete graph["250"];
    delete graph["284"];
    if (!usesVoiceActorAudio) {
      delete graph["242"];
      delete graph["309"];
    }

    setNodeIfPresent(graph, "169", { text: positiveText });
    if (negativeText) {
      setNodeIfPresent(graph, "165", { text: negativeText });
    }
    setNodeIfPresent(graph, "240", { image: assets.imageA });
    setNodeIfPresent(graph, "311", { image: assets.imageB });
    setNodeIfPresent(graph, "241", { width: 1280, height: 720, keep_proportion: "resize" });
    setNodeIfPresent(graph, "312", {
      "1": ["311", 0],
      background: ["240", 0],
      width: ["241", 1],
      height: ["241", 2],
      // LiconMSR guide count is an enum [17, 25, 33, 41], not the final video duration.
      frame_count: 25,
    });
    setNodeIfPresent(graph, "313", {
      lora_name: "LTX-2.3-Licon-MSR-V1.safetensors",
      strength_model: 1,
      model: ["310", 0],
    });
    setNodeIfPresent(graph, "314", {
      crop: "center",
      positive: ["164", 0],
      negative: ["164", 1],
      vae: ["275", 0],
      latent: ["162", 0],
      image: ["312", 0],
    });
    setNodeIfPresent(graph, "153", { model: ["313", 0], positive: ["314", 0], negative: ["314", 1] });
    if (usesVoiceActorAudio) {
      const voiceActorAudio = String(assets.audioA || "");
      setNodeIfPresent(graph, "309", { audio: voiceActorAudio });
      setNodeIfPresent(graph, "242", { audio: ["309", 0], audio_vae: ["278", 0] });
      setNodeIfPresent(graph, "166", { video_latent: ["314", 2], audio_latent: ["242", 0] });
      setFirstLoadAudioNode(graph, voiceActorAudio);
    } else {
      setNodeIfPresent(graph, "166", { video_latent: ["314", 2], audio_latent: ["316", 0] });
    }
    setNodeIfPresent(graph, "234", { samples: ["315", 2] });
    setNodeIfPresent(graph, "162", { length: ["317", 0] });
    setNodeIfPresent(graph, "292", { Number: 25 });
    setNodeIfPresent(graph, "316", { frames_number: ["317", 0], frame_rate: 25, audio_vae: ["278", 0] });
    setNodeIfPresent(graph, "317", { value: referenceLatentFrameCount });
    setNodeIfPresent(graph, "291", { fps: ["292", 0] });
    if (usesVoiceActorAudio) {
      setNodeIfPresent(graph, "291", { audio: ["309", 0] });
    } else if (graph?.["291"]?.inputs && typeof graph["291"].inputs === "object") {
      delete graph["291"].inputs.audio;
    }
    setNodeIfPresent(graph, "310", { unet_name: "ltx-2.3-22b-distilled-Q4_K_M.gguf" });
    setNodeIfPresent(graph, "178", { noise_seed: Number.isFinite(seedValue) ? Math.floor(seedValue) : Date.now() });
    setNodeIfPresent(graph, "290", { filename_prefix: outputPrefix });
    return;
  }

  if (
    key.includes("production/image-to-video-ltx23-1-1") ||
    key.includes("production-image-to-video") ||
    key.includes("production default image-to-video") ||
    key.includes("production-default-image-to-video") ||
    key.includes("presets/create a video from pictures") ||
    key.includes("presets/create a video from images") ||
    key.includes("create a video with picture")
  ) {
    const isFastLtx2I2vWorkflowV36BPU48 =
      graph?.["75"]?.class_type === "SaveVideo" &&
      graph?.["122"]?.class_type === "CreateVideo" &&
      graph?.["149"]?.class_type === "LoadImage" &&
      graph?.["112"]?.class_type === "PrimitiveInt";

    if (isFastLtx2I2vWorkflowV36BPU48) {
      const positiveText = String(body?.positivePrompt || body?.prompt || "");
      const negativeText = String(body?.negativePrompt || body?.neg || "");
      const seedValue = Number(body?.seed || body?.noiseSeed || Date.now());
      const safeSeed = Number.isFinite(seedValue) ? Math.floor(seedValue) : Date.now();
      const requestedSeconds = getLtx23RequestedSeconds();
      const frameRate = 24;
      const lengthFrames = Math.max(1, Math.floor(requestedSeconds * frameRate) + 1);
      const outputPrefix = String(body?.outputPrefix || "video/Production-I2V").trim() || "video/Production-I2V";

      if (!assets.imageA) {
        throw new Error("Missing image upload for Production image-to-video: imageA");
      }

      setNodeIfPresent(graph, "149", { image: assets.imageA });
      setNodeIfPresent(graph, "121", { text: positiveText });
      setNodeIfPresent(graph, "110", { text: negativeText });
      setNodeIfPresent(graph, "112", { value: lengthFrames });
      setNodeIfPresent(graph, "129", { value: frameRate });
      setNodeIfPresent(graph, "130", { value: frameRate });
      setNodeIfPresent(graph, "114", { noise_seed: safeSeed });
      setNodeIfPresent(graph, "115", { noise_seed: safeSeed + 1 });
      setNodeIfPresent(graph, "75", { filename_prefix: outputPrefix, format: "mp4", codec: "auto" });
      return;
    }

    setPromptPair();
    if (assets.imageA) {
      // Current LTX 2.3 v1.1 I2V graph.
      setNodeIfPresent(graph, "187", { image: assets.imageA });

      // Older/alternate I2V graphs.
      setNodeIfPresent(graph, "149", { image: assets.imageA });
      setNodeIfPresent(graph, "240", { image: assets.imageA });

      // Production uploaded image-to-video LTX 2.3.1 workflow.
      setNodeIfPresent(graph, "1896", { image: assets.imageA });

      setFirstLoadImageNode(graph, assets.imageA);
    }
    setNodeIfPresent(graph, "1879", { text: String(body?.positivePrompt || body?.prompt || "") });
    setNodeIfPresent(graph, "389:387", { value: getLtx23RequestedSeconds() });
    applyProductionLtx23NativeVideoDefaultsV36BPU31();
    removeProductionAnimateOutputOnlyHelpersV36BPU46({ keepAudio: true });
    ensureProductionLtx23OutputAudioV36BPU47();
    setNodeIfPresent(graph, "389:363", { noise_seed: Number.isFinite(Number(body?.seed || body?.noiseSeed)) ? Math.floor(Number(body?.seed || body?.noiseSeed)) : Date.now() });
    setNodeIfPresent(graph, "172", { filename_prefix: "video/Production-I2V" });
    if (applyLtx23V11TextToVideoDuration()) {
      return;
    }
    if (!applyLegacyLtxDuration("209:204", "209:214")) {
      applySliderDuration();
    }
    return;
  }

  if (key.includes("presets/admin")) {
    setPromptPair();
    if (!applyLegacyLtxDuration("201:204", "201:214")) {
      applySliderDuration();
    }
    return;
  }

  if (key.includes("presets/create a video")) {
    setPromptPair();
    if (applyLtx23V11TextToVideoDuration()) {
      return;
    }
    if (!applyLegacyLtxDuration("201:204", "201:214")) {
      applySliderDuration();
    }
    return;
  }

  if (key.includes("presets/extend a video")) {
    setPromptPair();
    if (assets.videoA) {
      setNodeIfPresent(graph, "222", { video: assets.videoA });
      setFirstLoadVideoNode(graph, assets.videoA);
    }
    applySliderDuration();
    return;
  }

  if (key.includes("presets/production workflow")) {
    setPromptPair();
    if (assets.imageA) {
      setNodeIfPresent(graph, "275", { image: assets.imageA });
      setFirstLoadImageNode(graph, assets.imageA);
    }
    if (assets.audioA) {
      setNodeIfPresent(graph, "276", { audio: assets.audioA });
      setFirstLoadAudioNode(graph, assets.audioA);
    }
    applySliderDuration();
    return;
  }

  if (assets.imageA) {
    setFirstLoadImageNode(graph, assets.imageA);
  }
  if (assets.videoA) {
    setFirstLoadVideoNode(graph, assets.videoA);
  }
  if (assets.audioA) {
    setFirstLoadAudioNode(graph, assets.audioA);
  }
}

function sanitizePostedString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeBodyRequestMeta(body: any) {
  const title = sanitizePostedString(body?.title);
  const workflowLabel = sanitizePostedString(body?.workflowLabel);
  const requestKind = sanitizePostedString(body?.requestKind);
  const extendRequestId = sanitizePostedString(body?.extendRequestId);
  const sourceType = sanitizePostedString(body?.sourceType);
  const extendedFromName = sanitizePostedString(body?.extendedFromName);
  const extendSourceFrame = sanitizePostedString(body?.extendSourceFrame);
  const extendMode = sanitizePostedString(body?.extendMode);

  const inferredGalleryExtend =
    requestKind === "gallery-extend" ||
    sourceType === "gallery-extend" ||
    !!extendedFromName ||
    !!extendSourceFrame ||
    !!extendMode ||
    workflowLabel === "Gallery Extend" ||
    (!!title && /^gallery-extend-/i.test(title));

  return {
    title: title || (inferredGalleryExtend && extendedFromName ? `gallery-extend-${extendedFromName}` : null),
    workflowLabel: workflowLabel || (inferredGalleryExtend ? "Gallery Extend" : null),
    requestKind: requestKind || (inferredGalleryExtend ? "gallery-extend" : null),
    extendRequestId,
    sourceType: sourceType || (inferredGalleryExtend ? "gallery-extend" : null),
    extendedFromName,
    extendSourceFrame,
    extendMode: extendMode || (inferredGalleryExtend ? "last-frame-continue" : null),
  };
}

async function parseOtgBody(req: NextRequest, comfyBaseUrl: string) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  if (!ct.includes("multipart/form-data")) {
    try {
      const rawBody = (await req.json()) as any;
      if (rawBody && typeof rawBody === "object") {
        if (!rawBody.preset && rawBody.workflowId) {
          rawBody.preset = rawBody.workflowId;
        }
        const meta = normalizeBodyRequestMeta(rawBody);
        rawBody.title = meta.title;
        rawBody.workflowLabel = meta.workflowLabel;
        rawBody.requestKind = meta.requestKind;
        rawBody.extendRequestId = meta.extendRequestId;
        rawBody.sourceType = meta.sourceType;
        rawBody.extendedFromName = meta.extendedFromName;
        rawBody.extendSourceFrame = meta.extendSourceFrame;
        rawBody.extendMode = meta.extendMode;
      }
      return rawBody;
    } catch {
      return null;
    }
  }

  const fd = await req.formData().catch(() => null);
  const otgGeneralGallerySuppressedV36BP3F_fd_2 = fd ? otgApplyNoGeneralGalleryPolicyToFormDataV36BP3F(fd) : false;
  if (!fd) return null;

  const otgMetaRaw = String(fd.get("otgMeta") || "").trim();
  let otgMeta: any = null;
  if (otgMetaRaw) {
    try {
      const parsed = JSON.parse(otgMetaRaw);
      if (parsed && typeof parsed === "object") otgMeta = parsed;
    } catch {
      otgMeta = null;
    }
  }

  const preset = String(fd.get("workflowId") || fd.get("preset") || otgMeta?.workflowId || otgMeta?.preset || "").trim();
  const isCharacterCardExactWorkflowRequestV36BPT5 = [
    preset,
    fd.get("workflowId"),
    fd.get("preset"),
    fd.get("requestKind"),
    fd.get("sourceType"),
    otgMeta?.workflowId,
    otgMeta?.preset,
    otgMeta?.requestKind,
    otgMeta?.sourceType,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ")
    .includes("presets/character_card_8_angles_low_angle") || [
      preset,
      fd.get("workflowId"),
      fd.get("preset"),
      fd.get("requestKind"),
      fd.get("sourceType"),
      otgMeta?.workflowId,
      otgMeta?.preset,
      otgMeta?.requestKind,
      otgMeta?.sourceType,
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ")
      .includes("characters-8-angle-card");
  const workflowFile = isCharacterCardExactWorkflowRequestV36BPT5 ? "" : String(fd.get("workflowFile") || otgMeta?.workflowFile || "").trim();
  const workflowPath = isCharacterCardExactWorkflowRequestV36BPT5 ? "" : String(fd.get("workflowPath") || fd.get("workflowJsonPath") || fd.get("workflowPresetPath") || otgMeta?.workflowPath || otgMeta?.workflowJsonPath || otgMeta?.workflowPresetPath || "").trim();
  const workflowSource = String(fd.get("workflowSource") || otgMeta?.workflowSource || "").trim();
  const positivePrompt = isCharacterCardExactWorkflowRequestV36BPT5 ? "" : String(fd.get("prompt") || fd.get("positivePrompt") || otgMeta?.positivePrompt || "");
  const negativePrompt = isCharacterCardExactWorkflowRequestV36BPT5 ? "" : String(fd.get("negativePrompt") || otgMeta?.negativePrompt || "");
  const orientation = String(fd.get("orientation") || otgMeta?.orientation || "");
  const durationSecondsRaw = String(fd.get("durationSeconds") || otgMeta?.durationSeconds || otgMeta?.durationSec || "").trim();
  const frameCountRaw = String(fd.get("frameCount") || otgMeta?.frameCount || "").trim();
  const durationSeconds = durationSecondsRaw ? Number(durationSecondsRaw) : undefined;
  const frameCount = frameCountRaw ? Number(frameCountRaw) : undefined;
  const seed = String(fd.get("seed") || otgMeta?.seed || "");
  const width = String(fd.get("width") || otgMeta?.width || "");
  const height = String(fd.get("height") || otgMeta?.height || "");
  const promptJson = String(fd.get("promptJson") || fd.get("api") || fd.get("prompt_api") || otgMeta?.promptJson || "");
  const promptRelayGlobalPrompt = String(fd.get("promptRelayGlobalPrompt") || fd.get("globalPrompt") || otgMeta?.promptRelayGlobalPrompt || otgMeta?.globalPrompt || "").trim();
  const promptRelayLocalPrompts = String(fd.get("promptRelayLocalPrompts") || fd.get("localPrompts") || fd.get("smartPrompt") || otgMeta?.promptRelayLocalPrompts || otgMeta?.localPrompts || otgMeta?.smartPrompt || "").trim();
  const promptRelaySegmentLengths = String(fd.get("promptRelaySegmentLengths") || fd.get("segmentLengths") || otgMeta?.promptRelaySegmentLengths || otgMeta?.segmentLengths || "").trim();
  const promptRelayEpsilon = String(fd.get("promptRelayEpsilon") || otgMeta?.promptRelayEpsilon || "").trim();
  const characterContinuityPrompt = String(fd.get("characterContinuityPrompt") || otgMeta?.characterContinuityPrompt || "").trim();
  const selectedCharacterIdentitiesRaw = String(fd.get("selectedCharacterIdentities") || otgMeta?.selectedCharacterIdentities || "").trim();
  const angleHorizontal = String(fd.get("angleHorizontal") || otgMeta?.angleHorizontal || "").trim();
  const angleVertical = String(fd.get("angleVertical") || otgMeta?.angleVertical || "").trim();
  const angleZoom = String(fd.get("angleZoom") || otgMeta?.angleZoom || "").trim();
  const angleDefaultPrompts = String(fd.get("angleDefaultPrompts") || otgMeta?.angleDefaultPrompts || "").trim();
  const angleCameraView = String(fd.get("angleCameraView") || otgMeta?.angleCameraView || "").trim();
  const gpuTarget = String(fd.get("gpuTarget") || otgMeta?.gpuTarget || "").trim();
  const title = String(fd.get("title") || fd.get("name") || otgMeta?.title || "").trim();
  const workflowLabel = String(fd.get("workflowLabel") || fd.get("label") || otgMeta?.workflowLabel || otgMeta?.label || "").trim();
  const requestKind = String(fd.get("requestKind") || otgMeta?.requestKind || "").trim();
  const extendRequestId = String(fd.get("extendRequestId") || otgMeta?.extendRequestId || "").trim();
  const sourceType = String(fd.get("sourceType") || otgMeta?.sourceType || "").trim();
  const productionAnimateUploadWorkflowFileV36BPU35 = productionAnimateWorkflowFileForBody({
    workflowId: preset,
    preset,
    workflowFile,
    workflowPath,
    workflowJsonPath: workflowPath,
    workflowPresetPath: workflowPath,
    workflowLabel,
    requestKind,
    sourceType,
  });
  const shouldNormalizeProductionAnimateImageUploadV36BPU35 =
    productionAnimateUploadWorkflowFileV36BPU35 === "production-image-to-video.json" ||
    productionAnimateUploadWorkflowFileV36BPU35 === "production-first-frame-last-frame.json" ||
    productionAnimateUploadWorkflowFileV36BPU35 === "production-lipsync.json" ||
    productionAnimateUploadWorkflowFileV36BPU35 === "production-reference-video-gguf.json" ||
    productionAnimateUploadWorkflowFileV36BPU35 === "production-reference-video-gguf-voice-actor.json";
  const isProductionReferenceVideoGgufUploadV36BPU37 =
    productionAnimateUploadWorkflowFileV36BPU35 === "production-reference-video-gguf.json" ||
    productionAnimateUploadWorkflowFileV36BPU35 === "production-reference-video-gguf-voice-actor.json";
  const extendedFromName = String(fd.get("extendedFromName") || otgMeta?.extendedFromName || "").trim();
  const extendSourceFrame = String(fd.get("extendSourceFrame") || otgMeta?.extendSourceFrame || "").trim();
  const extendMode = String(fd.get("extendMode") || otgMeta?.extendMode || "").trim();
  const loadImageNodeId = String(fd.get("loadImageNodeId") || fd.get("imageNodeId") || otgMeta?.loadImageNodeId || otgMeta?.imageNodeId || "").trim();
  const saveImageNodeId = String(fd.get("saveImageNodeId") || otgMeta?.saveImageNodeId || "").trim();
  const filenamePrefix = String(fd.get("filenamePrefix") || fd.get("filename_prefix") || otgMeta?.filenamePrefix || otgMeta?.filename_prefix || "").trim();
  const saveToGallery = String(fd.get("saveToGallery") || "").trim();
  const saveToGallerySnake = String(fd.get("save_to_gallery") || "").trim();
  const persistToGallery = String(fd.get("persistToGallery") || "").trim();
  const addToGallery = String(fd.get("addToGallery") || "").trim();
  const copyToGallery = String(fd.get("copyToGallery") || "").trim();
  const writeToGallery = String(fd.get("writeToGallery") || "").trim();
  const gallery = String(fd.get("gallery") || "").trim();
  const skipGallery = String(fd.get("skipGallery") || "").trim();
  const skipGeneralGallery = String(fd.get("skipGeneralGallery") || "").trim();
  const assetLibraryOnly = String(fd.get("assetLibraryOnly") || "").trim();
  const outputLibrary = String(fd.get("outputLibrary") || "").trim();
  const galleryExclusionPolicy = String(fd.get("galleryExclusionPolicy") || "").trim();

  const lorasRaw = fd.get("loras");
  let loras: any = null;
  if (typeof lorasRaw === "string" && lorasRaw.trim()) {
    try {
      const parsed = JSON.parse(lorasRaw);
      if (Array.isArray(parsed)) loras = parsed;
    } catch {}
  }
  const videoLoras = parsePostedVideoLoras(fd.get("videoLoras") ?? otgMeta?.videoLoras);
  const loraAdultAcknowledged = String(fd.get("loraAdultAcknowledged") || otgMeta?.loraAdultAcknowledged || "").trim();
  const loraAdultAcknowledgementVersion = String(
    fd.get("loraAdultAcknowledgementVersion") || otgMeta?.loraAdultAcknowledgementVersion || ""
  ).trim();
  let selectedCharacterIdentities: any = null;
  if (selectedCharacterIdentitiesRaw) {
    try {
      const parsed = JSON.parse(selectedCharacterIdentitiesRaw);
      if (Array.isArray(parsed)) {
        selectedCharacterIdentities = parsed
          .map((item: any) => ({
            slot: String(item?.slot || "").slice(0, 16),
            id: String(item?.id || "").slice(0, 120),
            name: String(item?.name || "").slice(0, 160),
            lockedAt: String(item?.lockedAt || "").slice(0, 80),
            promptReadyDescription: String(item?.promptReadyDescription || "").replace(/\s+/g, " ").trim().slice(0, 1200),
          }))
          .filter((item: any) => item.name || item.id || item.promptReadyDescription);
      }
    } catch {}
  }

  const inputImages: string[] = [];
  let imageA: string | null = null;
  let imageB: string | null = null;
  let videoA: string | null = null;
  let audioA: string | null = null;

  for (const key of ["imageA", "imageB", "imageC", "imageD", "imageE"]) {
    const v = fd.get(key);
    const serverPath = String(fd.get(`${key}Path`) || "").trim();
    if ((!v || typeof v === "string") && !serverPath) continue;
    try {
      const uploadFile =
        !serverPath && shouldNormalizeProductionAnimateImageUploadV36BPU35 && (key === "imageA" || key === "imageB")
          ? isProductionReferenceVideoGgufUploadV36BPU37
            ? await normalizeProductionReferenceVideoImageForComfyV36BPU37(v as File, key)
            : await normalizeProductionAnimateImageForComfyV36BPU35(v as File)
          : (v as File);
      const name = serverPath
        ? await uploadServerImagePathToComfy(serverPath, comfyBaseUrl)
        : await uploadFormFileToComfy(uploadFile, comfyBaseUrl, "image");
      inputImages.push(name);
      if (key === "imageA") imageA = name;
      if (key === "imageB") imageB = name;
    } catch (e: any) {
      throw new Error(`Image upload failed for ${key}: ${String(e?.message || e)}`);
    }
  }

  if (inputImages.length > 1) {
    const seenImages = new Set<string>();
    const uniqueInputImages = inputImages.filter((name) => {
      const dedupeKey = String(name || "").trim().toLowerCase();
      if (!dedupeKey || seenImages.has(dedupeKey)) return false;
      seenImages.add(dedupeKey);
      return true;
    });
    inputImages.length = 0;
    inputImages.push(...uniqueInputImages);
    imageA = inputImages[0] || null;
    imageB = inputImages[1] || null;
  }

  const rawVideo = fd.get("videoA");
  if (rawVideo && typeof rawVideo !== "string") {
    try {
      videoA = await uploadFormFileToComfy(rawVideo as File, comfyBaseUrl, "image");
    } catch (e: any) {
      throw new Error(`Video upload failed for videoA: ${String(e?.message || e)}`);
    }
  }

  const rawAudio = fd.get("audioA");
  if (rawAudio && typeof rawAudio !== "string") {
    try {
      audioA = await uploadFormFileToComfy(rawAudio as File, comfyBaseUrl, "audio");
    } catch (e: any) {
      throw new Error(`Audio upload failed for audioA: ${String(e?.message || e)}`);
    }
  }

  const requestMeta = normalizeBodyRequestMeta({
    ...(otgMeta && typeof otgMeta === "object" ? otgMeta : {}),
    title,
    workflowLabel,
    requestKind,
    extendRequestId,
    sourceType,
    extendedFromName,
    extendSourceFrame,
    extendMode,
  });

  return {
    preset,
    workflowId: preset,
    workflowFile,
    workflowPath,
    workflowJsonPath: workflowPath,
    workflowPresetPath: workflowPath,
    workflowSource,
    positivePrompt,
    negativePrompt,
    orientation,
    durationSeconds,
    frameCount,
    seed,
    width,
    height,
    promptJson,
    promptRelayGlobalPrompt,
    promptRelayLocalPrompts,
    promptRelaySegmentLengths,
    promptRelayEpsilon,
    characterContinuityPrompt,
    selectedCharacterIdentities,
    angleHorizontal,
    angleVertical,
    angleZoom,
    angleDefaultPrompts,
    angleCameraView,
    inputImages,
    imageA,
    imageB,
    videoA,
    audioA,
    gpuTarget,
    title: requestMeta.title,
    workflowLabel: requestMeta.workflowLabel,
    requestKind: requestMeta.requestKind,
    extendRequestId: requestMeta.extendRequestId,
    loras,
    videoLoras,
    loraAdultAcknowledged,
    loraAdultAcknowledgementVersion,
    sourceType: requestMeta.sourceType,
    loadImageNodeId,
    saveImageNodeId,
    filenamePrefix,
    filename_prefix: filenamePrefix,
    saveToGallery,
    save_to_gallery: saveToGallerySnake,
    persistToGallery,
    addToGallery,
    copyToGallery,
    writeToGallery,
    gallery,
    skipGallery,
    skipGeneralGallery,
    assetLibraryOnly,
    outputLibrary,
    galleryExclusionPolicy,
    extendedFromName: requestMeta.extendedFromName,
    extendSourceFrame: requestMeta.extendSourceFrame,
    extendMode: requestMeta.extendMode,
    voiceActorBaseMode: String(fd.get("voiceActorBaseMode") || "").trim(),
    voiceActorUsesLastFrame: String(fd.get("voiceActorUsesLastFrame") || "").trim(),
    voiceActorInput: String(fd.get("voiceActorInput") || "").trim(),
    voiceActorRecordedSeconds: String(fd.get("voiceActorRecordedSeconds") || "").trim(),
    voiceActorTrimSeconds: String(fd.get("voiceActorTrimSeconds") || "").trim(),
  };
}

// OTG_CHARACTER_KREA2_IMAGE_MODEL_V36BPV2
function isKrea2TurboWorkflow(body: any, graph: any) {
  const hay = [
    body?.workflowId,
    body?.preset,
    body?.workflowFile,
    body?.workflowPath,
    body?.workflowJsonPath,
    body?.workflowPresetPath,
    body?.workflowLabel,
    body?.characterGeneratorOption,
    body?.characterGeneratorLabel,
    body?.requestKind,
    body?.sourceType,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  if (
    hay.includes("krea2") ||
    hay.includes("krea-2") ||
    hay.includes("krea 2") ||
    hay.includes("krea2-turbo") ||
    hay.includes("krea2_turbo")
  ) {
    return true;
  }

  const unetName = String(graph?.["55"]?.inputs?.unet_name || "").toLowerCase();
  const clipType = String(graph?.["56"]?.inputs?.type || "").toLowerCase();
  return unetName.includes("krea2") || clipType === "krea2";
}

function getKrea2TurboTargetSize(body: any) {
  const rawWidth = Number(body?.width || body?.imageWidth || body?.expectedWidth);
  const rawHeight = Number(body?.height || body?.imageHeight || body?.expectedHeight);

  if (Number.isFinite(rawWidth) && rawWidth > 0 && Number.isFinite(rawHeight) && rawHeight > 0) {
    return {
      width: Math.max(64, Math.round(rawWidth)),
      height: Math.max(64, Math.round(rawHeight)),
    };
  }

  const orientation = String(body?.orientation || "landscape").toLowerCase();
  return orientation === "portrait" ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
}

function applyKrea2TurboOverrides(graph: any, body: any) {
  if (!graph || typeof graph !== "object") return;

  const positiveText = String(body?.positivePrompt || body?.prompt || "").trim();
  const targetSize = getKrea2TurboTargetSize(body);
  const seedValue = Number(body?.seed || body?.noiseSeed || Date.now());
  const prefixBase = String(
    body?.expectedOutputName ||
      body?.currentRunOutputName ||
      body?.outputName ||
      body?.outputBaseName ||
      body?.outputPrefix ||
      body?.filenamePrefix ||
      body?.filename_prefix ||
      body?.expectedFilenamePrefix ||
      body?.saveFilenamePrefix ||
      body?.comfyFilenamePrefix ||
      body?.title ||
      body?.name ||
      "Krea2_turbo"
  )
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_");

  if (positiveText) {
    setNodeIfPresent(graph, "51", { text: positiveText });
  }

  setNodeIfPresent(graph, "52", {
    width: targetSize.width,
    height: targetSize.height,
    batch_size: 1,
  });

  setNodeIfPresent(graph, "53", {
    seed: Number.isFinite(seedValue) ? Math.floor(seedValue) : Date.now(),
    steps: 8,
    cfg: 1,
    sampler_name: "euler",
    scheduler: "simple",
    denoise: 1,
  });

  setNodeIfPresent(graph, "29", {
    filename_prefix: prefixBase || "Krea2_turbo",
  });
}
function isAnimeImagesWorkflow(body: any, graph: any) {
  const key = workflowKey(body);
  if (
    key.includes("presets/create anime images") ||
    key.includes("create anime images") ||
    key.includes("anime images") ||
    key.includes("anima")
  ) {
    return true;
  }

  const animaModel = graph?.["68"]?.inputs?.unet_name;
  if (typeof animaModel === "string" && animaModel.toLowerCase().includes("anima-preview")) return true;

  return false;
}

function getAnimeImagesTargetSize(body: any) {
  const orientation = String(body?.orientation || "landscape").toLowerCase();
  if (orientation === "portrait") {
    return { width: 720, height: 1280 };
  }

  return { width: 1280, height: 720 };
}

function applyAnimeImagesOverrides(graph: any, body: any) {
  if (!graph || typeof graph !== "object") return;

  const positiveText = String(body?.positivePrompt || body?.prompt || "").trim();
  otgApplyQwenNextScenePromptFromRequestV36BO4(graph, body);
  const negativeText = String(body?.negativePrompt || body?.neg || "").trim();
  const targetSize = getAnimeImagesTargetSize(body);

  if (positiveText) setNodeIfPresent(graph, "67", { text: positiveText });
  if (negativeText) setNodeIfPresent(graph, "65", { text: negativeText });

  // Create Anime Images is an image workflow. Force real 720p output.
  // Landscape = 1280x720. Portrait = 720x1280.
  setNodeIfPresent(graph, "64", {
    width: targetSize.width,
    height: targetSize.height,
    batch_size: 1,
  });

  // Preserve the known-good Anima sampler settings from the uploaded API graph.
  setNodeIfPresent(graph, "66", {
    steps: 30,
    cfg: 4,
    sampler_name: "er_sde",
    scheduler: "simple",
    denoise: 1,
  });

  setNodeIfPresent(graph, "46", { filename_prefix: "Anima" });
}

function isEditImageWorkflow(body: any, graph: any) {
  const key = workflowKey(body);
  const label = String(body?.workflowLabel || body?.label || body?.workflowName || "").toLowerCase();

  if (
    key.includes("presets/edit image") ||
    key.includes("edit image") ||
    key.includes("edit picture") ||
    label.includes("edit image") ||
    label.includes("edit picture")
  ) {
    return true;
  }

  const modelName = graph?.["433:37"]?.inputs?.unet_name;
  const promptNode = graph?.["435"]?.class_type;
  const outputNode = graph?.["60"]?.class_type;

  return (
    typeof modelName === "string" &&
    modelName.toLowerCase().includes("qwen_image_edit") &&
    promptNode === "PrimitiveStringMultiline" &&
    outputNode === "SaveImage"
  );
}

function applyEditImageOverrides(graph: any, body: any) {
  if (!graph || typeof graph !== "object") return;

  const imageA = typeof body?.imageA === "string" ? body.imageA : null;
  if (imageA) {
    setFirstLoadImageNode(graph, imageA);
    setNodeIfPresent(graph, "78", { image: imageA });
  }

  const positiveText = String(body?.positivePrompt || body?.prompt || "").trim();
  otgApplyQwenNextScenePromptFromRequestV36BO4(graph, body);
  const negativeText = String(body?.negativePrompt || body?.neg || "").trim();
  const characterCandidateEdit = `${String(body?.requestKind || "")} ${String(body?.sourceType || "")}`
    .toLowerCase()
    .includes("character-candidate-edit");

  if (positiveText) {
    setNodeIfPresent(graph, "435", { value: positiveText });
    if (characterCandidateEdit) {
      // Candidate edits use the user's requested change plus preservation text verbatim.
      // Do not apply the Production "Next Scene" prompt adapter here.
      setNodeIfPresent(graph, "433:111", { prompt: positiveText });
    } else {
      otgForceAllQwenPositivePromptsV36BO4B(graph, positiveText);
    }
  }

  // Qwen Image Edit uses TextEncodeQwenImageEditPlus. Keep negative empty unless the user explicitly provides one.
  setNodeIfPresent(graph, "433:110", { prompt: negativeText || "" });

  setNodeIfPresent(graph, "60", { filename_prefix: "Edit_Image" });

  // Uploaded better workflow uses Lightning LoRA by default: 4 steps, CFG 1.
  setNodeIfPresent(graph, "433:443", { value: true });
  setNodeIfPresent(graph, "433:436", { value: 4 });
  setNodeIfPresent(graph, "433:437", { value: 1 });
  setNodeIfPresent(graph, "433:3", {
    sampler_name: "euler",
    scheduler: "simple",
    denoise: 1,
  });
}

function assertCharacterCandidateEditContract(graph: any, body: any) {
  const context = `${String(body?.requestKind || "")} ${String(body?.sourceType || "")}`.toLowerCase();
  if (!context.includes("character-candidate-edit")) return;

  const expected = [
    ["78", "LoadImage"],
    ["433:111", "TextEncodeQwenImageEditPlus"],
    ["433:110", "TextEncodeQwenImageEditPlus"],
    ["433:3", "KSampler"],
    ["433:443", "PrimitiveBoolean"],
    ["433:436", "PrimitiveInt"],
    ["433:437", "PrimitiveFloat"],
    ["433:8", "VAEDecode"],
    ["60", "SaveImage"],
  ] as const;
  for (const [nodeId, classType] of expected) {
    if (String(graph?.[nodeId]?.class_type || "") !== classType) {
      throw new Error(`Character candidate edit workflow contract mismatch at node ${nodeId}; expected ${classType}.`);
    }
  }

  const exactValues = [
    [graph?.["433:37"]?.inputs?.unet_name, "qwen_image_edit_2509_fp8_e4m3fn.safetensors", "model"],
    [graph?.["433:38"]?.inputs?.clip_name, "qwen_2.5_vl_7b_fp8_scaled.safetensors", "CLIP"],
    [graph?.["433:39"]?.inputs?.vae_name, "qwen_image_vae.safetensors", "VAE"],
    [graph?.["433:89"]?.inputs?.lora_name, "Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors", "LoRA"],
  ] as const;
  for (const [actual, expectedValue, label] of exactValues) {
    if (String(actual || "") !== expectedValue) {
      throw new Error(`Character candidate edit ${label} contract mismatch; expected ${expectedValue}.`);
    }
  }
  if (graph?.["433:443"]?.inputs?.value !== true || Number(graph?.["433:436"]?.inputs?.value) !== 4 || Number(graph?.["433:437"]?.inputs?.value) !== 1) {
    throw new Error("Character candidate edit Lightning/4-step/CFG 1 contract mismatch.");
  }
  if (String(graph?.["433:111"]?.inputs?.prompt || "") !== String(body?.positivePrompt || body?.prompt || "").trim()) {
    throw new Error("Character candidate edit positive instruction was not bound verbatim to node 433:111.");
  }
  if (String(graph?.["433:110"]?.inputs?.prompt || "") !== String(body?.negativePrompt || body?.neg || "").trim()) {
    throw new Error("Character candidate edit negative prompt was not bound to node 433:110.");
  }
}

function isLtxVideoWorkflow(body: any, graph: any) {
  const preset = String(body?.preset || body?.workflowId || body?.id || "").toLowerCase();
  const label = String(body?.workflowLabel || body?.label || body?.workflowName || "").toLowerCase();

  if (preset.includes("ltx") || label.includes("ltx")) return true;
  if (label.includes("create a video")) return true;

  const nodes = graph && typeof graph === "object" ? Object.values(graph as Record<string, any>) : [];
  return nodes.some((node: any) => {
    const classType = String(node?.class_type || "").toLowerCase();
    return classType.includes("ltx") || classType.includes("lightricks");
  });
}

export async function GET(req: NextRequest) {
  const deviceId = safeDeviceId(req.headers.get("x-otg-device-id"));
  const mode = String(req.nextUrl.searchParams.get("mode") || "").toLowerCase();
  const preset = String(req.nextUrl.searchParams.get("preset") || req.nextUrl.searchParams.get("workflow") || "").trim();
  const label = String(req.nextUrl.searchParams.get("label") || "").trim();
  const route = configuredComfyBaseUrlForJob({ mode, preset, label });
  const comfyBaseUrl = route.baseUrl;
  logComfyRouting("/api/comfy GET", { mode, preset, label }, route);

  try {
    const r = await fetch(`${comfyBaseUrl}/system_stats`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    const otgGeneralGallerySuppressedV36BP3F_j = otgApplyNoGeneralGalleryPolicyToRecordV36BP3F(j as Record<string, unknown>);
    return Response.json(
      {
        serverState: r.ok ? "idle" : "down",
        serverHint: r.ok ? "Connected" : "Disconnected",
        comfyBaseUrl,
        deviceId: deviceId || null,
        upstreamStatus: r.status,
        system_stats: j,
      },
      { status: r.ok ? 200 : 502 }
    );
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json(
      { serverState: "down", serverHint: "Disconnected", error: String(e?.message || e) },
      { status: 502 }
    );
  }
}


function otgSetWorkflowNodeInputV36AB(workflow: any, nodeId: string, inputName: string, value: any) {
  const cleanNodeId = String(nodeId || "").trim();
  const cleanInputName = String(inputName || "").trim();

  if (!cleanNodeId || !cleanInputName) return false;

  const node = workflow?.[cleanNodeId];

  if (!node || typeof node !== "object") return false;

  if (!node.inputs || typeof node.inputs !== "object") {
    node.inputs = {};
  }

  node.inputs[cleanInputName] = value;
  return true;
}

function otgFormValueV36AB(formData: FormData, ...names: string[]) {
  for (const name of names) {
    const value = formData.get(name);
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function otgCoerceOverrideValueV36AB(value: string) {
  const text = String(value ?? "").trim();

  if (text === "true") return true;
  if (text === "false") return false;

  if (/^-?\d+$/.test(text)) {
    const parsed = Number.parseInt(text, 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (/^-?\d+\.\d+$/.test(text)) {
    const parsed = Number.parseFloat(text);
    if (Number.isFinite(parsed)) return parsed;
  }

  return text;
}

function otgApplyComfyNodeOverridesV36AB(workflow: any, formData: FormData) {
  const applied: string[] = [];

  for (const [key, rawValue] of formData.entries()) {
    if (typeof rawValue !== "string") continue;

    const match = /^nodeOverride\.([^.]+)\.inputs\.([^.]+)$/.exec(key);
    if (!match) continue;

    const nodeId = match[1];
    const inputName = match[2];
    const value = otgCoerceOverrideValueV36AB(rawValue);

    if (otgSetWorkflowNodeInputV36AB(workflow, nodeId, inputName, value)) {
      applied.push(`${nodeId}.inputs.${inputName}`);
    }
  }

  const loadImageNodeId = otgFormValueV36AB(formData, "loadImageNodeId", "imageNodeId");
  const loadImageInput = otgFormValueV36AB(formData, "loadImageInput", "imageNodeInput") || "image";
  const loadImageValue = otgFormValueV36AB(
    formData,
    "loadImageValue",
    "loadImage",
    "inputImage",
    "sourceImage",
    "sourceImagePath",
    "imagePath",
    "image",
  );

  if (loadImageNodeId && loadImageValue) {
    if (otgSetWorkflowNodeInputV36AB(workflow, loadImageNodeId, loadImageInput, loadImageValue)) {
      applied.push(`${loadImageNodeId}.inputs.${loadImageInput}`);
    }
  }

  const promptNodeId = otgFormValueV36AB(formData, "promptNodeId", "positivePromptNodeId");
  const promptNodeInput = otgFormValueV36AB(formData, "promptNodeInput", "positivePromptNodeInput") || "prompt";
  const positivePrompt = otgFormValueV36AB(formData, "positivePrompt", "prompt");

  if (promptNodeId && positivePrompt) {
    if (otgSetWorkflowNodeInputV36AB(workflow, promptNodeId, promptNodeInput, positivePrompt)) {
      applied.push(`${promptNodeId}.inputs.${promptNodeInput}`);
    }
  }

  const negativePromptNodeId = otgFormValueV36AB(formData, "negativePromptNodeId");
  const negativePromptNodeInput = otgFormValueV36AB(formData, "negativePromptNodeInput") || "prompt";
  const negativePrompt = otgFormValueV36AB(formData, "negativePrompt");

  if (negativePromptNodeId) {
    if (otgSetWorkflowNodeInputV36AB(workflow, negativePromptNodeId, negativePromptNodeInput, negativePrompt)) {
      applied.push(`${negativePromptNodeId}.inputs.${negativePromptNodeInput}`);
    }
  }

  const saveImageNodeId = otgFormValueV36AB(formData, "saveImageNodeId");
  const saveImageInput = otgFormValueV36AB(formData, "saveImageInput") || "filename_prefix";
  const filenamePrefix = otgFormValueV36AB(formData, "filenamePrefix", "filename_prefix", "title");

  if (saveImageNodeId && filenamePrefix) {
    if (otgSetWorkflowNodeInputV36AB(workflow, saveImageNodeId, saveImageInput, filenamePrefix)) {
      applied.push(`${saveImageNodeId}.inputs.${saveImageInput}`);
    }
  }

  const seedNodeId = otgFormValueV36AB(formData, "seedNodeId");
  const seedNodeInput = otgFormValueV36AB(formData, "seedNodeInput") || "seed";
  const seedValue = otgFormValueV36AB(formData, "seed");

  if (seedNodeId && seedValue) {
    if (otgSetWorkflowNodeInputV36AB(workflow, seedNodeId, seedNodeInput, otgCoerceOverrideValueV36AB(seedValue))) {
      applied.push(`${seedNodeId}.inputs.${seedNodeInput}`);
    }
  }

  return applied;
}

// OTG_COMFY_NODE_OVERRIDES_V36AB

// OTG V36BO4A: force the exact submitted scene-builder prompt into Qwen positive prompt nodes.
function otgTextFromRequestSourceV36BO4(source: any, ...keys: string[]) {
  if (!source) return "";
  for (const key of keys) {
    let value: unknown = undefined;
    if (typeof source?.get === "function") {
      value = source.get(key);
    } else if (source && typeof source === "object") {
      value = source[key];
    }
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function otgCleanNextScenePromptForComfyV36BO4(value: unknown) {
  let text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  const hardStops = [
    "Composition rules:",
    "OTG anti-duplicate guard:",
    "Identity/Face lock:",
    "[OTG_TEMP_SCENE_ASSET_RULES_V36BN2]",
    "OTG_TEMP_SCENE_ASSET_RULES_V36BN2",
  ];

  for (const marker of hardStops) {
    const index = text.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0) text = text.slice(0, index).trim();
  }

  text = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^Next Scene(?:\s+\d+)?\s*[:;]\s*/i, "")
    .trim();

  return `Next Scene: ${text || "continue the scene"}`;
}

function otgApplyQwenNextScenePromptFromRequestV36BO4(graph: any, source: any) {
  const rawPrompt = otgTextFromRequestSourceV36BO4(
    source,
    "otgNextScenePromptV36BO4",
    "otgCompiledPromptV36BO4",
    "positivePrompt",
    "prompt",
    "scenePrompt",
  );

  if (!rawPrompt || !graph || typeof graph !== "object") return false;

  const prompt = otgCleanNextScenePromptForComfyV36BO4(rawPrompt);
  let changed = false;

  for (const node of Object.values<any>(graph)) {
    const classType = String(node?.class_type || "");
    if (!classType.includes("TextEncodeQwenImageEdit")) continue;
    if (!node.inputs || typeof node.inputs !== "object") node.inputs = {};

    const title = String(node?._meta?.title || node?.title || node?.name || "").toLowerCase();
    const isNegative = title.includes("negative");
    if (isNegative) continue;

    node.inputs.prompt = prompt;
    changed = true;
  }

  return changed;
}


// OTG V36BO4B: force submitted prompt into all Qwen Image Edit positive prompt nodes.
function otgCleanQwenPositivePromptV36BO4B(value: unknown) {
  let text = String(value ?? "").replace(/\r\n/g, "\n").trim();

  const hardStops = [
    "Composition rules:",
    "OTG anti-duplicate guard:",
    "Identity/Face lock:",
    "[OTG_TEMP_SCENE_ASSET_RULES_V36BN2]",
    "OTG_TEMP_SCENE_ASSET_RULES_V36BN2",
  ];

  for (const marker of hardStops) {
    const index = text.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0) text = text.slice(0, index).trim();
  }

  text = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^Next Scene(?:\s+\d+)?\s*[:;]\s*/i, "")
    .trim();

  return `Next Scene: ${text || "continue the scene"}`;
}

function otgForceAllQwenPositivePromptsV36BO4B(graph: any, rawPrompt: unknown) {
  const prompt = otgCleanQwenPositivePromptV36BO4B(rawPrompt);
  if (!graph || typeof graph !== "object") return false;

  let changed = false;
  const seen = new Set<any>();

  function visit(value: any) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    const classType = String(value?.class_type || value?.type || "");
    const title = String(value?._meta?.title || value?.title || value?.name || "").toLowerCase();
    const isQwenEditTextNode = classType.includes("TextEncodeQwenImageEdit") || title.includes("textencodeqwenimageedit");
    const isNegative = title.includes("negative");

    if (isQwenEditTextNode && !isNegative) {
      if (!value.inputs || typeof value.inputs !== "object") value.inputs = {};
      value.inputs.prompt = prompt;
      changed = true;
    }

    for (const child of Object.values(value)) visit(child);
  }

  visit(graph);
  return changed;
}


// OTG V36BO4C: force submitted prompt into all Qwen Image Edit positive prompt nodes.
function otgPromptValueFromAnySourceV36BO4C(source: any) {
  const keys = [
    "otgNextScenePromptV36BO4C",
    "otgCompiledPromptV36BO4C",
    "otgNextScenePromptV36BO4",
    "otgCompiledPromptV36BO4",
    "positivePrompt",
    "prompt",
    "scenePrompt",
  ];

  for (const key of keys) {
    let value: unknown = undefined;
    if (source && typeof source.get === "function") value = source.get(key);
    else if (source && typeof source === "object") value = source[key];

    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function otgCleanQwenPositivePromptV36BO4C(value: unknown) {
  let text = String(value ?? "").replace(/\r\n/g, "\n").trim();

  const hardStops = [
    "Composition rules:",
    "OTG anti-duplicate guard:",
    "Identity/Face lock:",
    "[OTG_TEMP_SCENE_ASSET_RULES_V36BN2]",
    "OTG_TEMP_SCENE_ASSET_RULES_V36BN2",
  ];

  for (const marker of hardStops) {
    const index = text.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0) text = text.slice(0, index).trim();
  }

  text = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^Next Scene(?:\s+\d+)?\s*[:;]\s*/i, "")
    .trim();

  return `Next Scene: ${text || "continue the scene"}`;
}

function otgForceAllQwenPositivePromptsV36BO4C(graph: any, rawPrompt: unknown) {
  const prompt = otgCleanQwenPositivePromptV36BO4C(rawPrompt);
  if (!graph || typeof graph !== "object") return false;

  let changed = false;
  const seen = new Set<any>();

  function visit(value: any) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    const classType = String(value?.class_type || value?.type || "");
    const title = String(value?._meta?.title || value?.title || value?.name || "").toLowerCase();
    const isQwenEditTextNode = classType.includes("TextEncodeQwenImageEdit") || title.includes("textencodeqwenimageedit");
    const isNegative = title.includes("negative");

    if (isQwenEditTextNode && !isNegative) {
      if (!value.inputs || typeof value.inputs !== "object") value.inputs = {};
      value.inputs.prompt = prompt;
      changed = true;
    }

    for (const child of Object.values(value)) visit(child);
  }

  visit(graph);
  return changed;
}


// OTG V36BO4D: force submitted prompt into all Qwen Image Edit positive prompt nodes.
function otgPromptValueFromAnySourceV36BO4D(source: any) {
  const keys = [
    "otgNextScenePromptV36BO4D",
    "otgCompiledPromptV36BO4D",
    "otgNextScenePromptV36BO4C",
    "otgCompiledPromptV36BO4C",
    "otgNextScenePromptV36BO4",
    "otgCompiledPromptV36BO4",
    "positivePrompt",
    "prompt",
    "scenePrompt",
  ];

  for (const key of keys) {
    let value: unknown = undefined;
    if (source && typeof source.get === "function") value = source.get(key);
    else if (source && typeof source === "object") value = source[key];

    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function otgCleanQwenPositivePromptV36BO4D(value: unknown) {
  let text = String(value ?? "").replace(/\r\n/g, "\n").trim();

  const hardStops = [
    "Composition rules:",
    "OTG anti-duplicate guard:",
    "Identity/Face lock:",
    "[OTG_TEMP_SCENE_ASSET_RULES_V36BN2]",
    "OTG_TEMP_SCENE_ASSET_RULES_V36BN2",
  ];

  for (const marker of hardStops) {
    const index = text.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0) text = text.slice(0, index).trim();
  }

  text = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^Next Scene(?:\s+\d+)?\s*[:;]\s*/i, "")
    .trim();

  return `Next Scene: ${text || "continue the scene"}`;
}

function otgForceAllQwenPositivePromptsV36BO4D(graph: any, rawPrompt: unknown) {
  const prompt = otgCleanQwenPositivePromptV36BO4D(rawPrompt);
  if (!graph || typeof graph !== "object") return false;

  let changed = false;
  const seen = new Set<any>();

  function visit(value: any) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    const classType = String(value?.class_type || value?.type || "");
    const title = String(value?._meta?.title || value?.title || value?.name || "").toLowerCase();
    const isQwenEditTextNode = classType.includes("TextEncodeQwenImageEdit") || title.includes("textencodeqwenimageedit");
    const isNegative = title.includes("negative");

    if (isQwenEditTextNode && !isNegative) {
      if (!value.inputs || typeof value.inputs !== "object") value.inputs = {};
      value.inputs.prompt = prompt;
      changed = true;
    }

    for (const child of Object.values(value)) visit(child);
  }

  visit(graph);
  return changed;
}


function otgAsLowerStringV36BP3F(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function otgValueFromFormDataV36BP3F(formData: FormData, keys: string[]): string {
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function otgShouldSuppressGeneralGalleryFromFormDataV36BP3F(formData: FormData | null | undefined): boolean {
  if (!formData) return false;
  const saveToGallery = otgAsLowerStringV36BP3F(formData.get("saveToGallery"));
  const saveToGallerySnake = otgAsLowerStringV36BP3F(formData.get("save_to_gallery"));
  const persistToGallery = otgAsLowerStringV36BP3F(formData.get("persistToGallery"));
  const addToGallery = otgAsLowerStringV36BP3F(formData.get("addToGallery"));
  const copyToGallery = otgAsLowerStringV36BP3F(formData.get("copyToGallery"));
  const writeToGallery = otgAsLowerStringV36BP3F(formData.get("writeToGallery"));
  const gallery = otgAsLowerStringV36BP3F(formData.get("gallery"));
  const skipGallery = otgAsLowerStringV36BP3F(formData.get("skipGallery"));
  const skipGeneralGallery = otgAsLowerStringV36BP3F(formData.get("skipGeneralGallery"));
  const assetLibraryOnly = otgAsLowerStringV36BP3F(formData.get("assetLibraryOnly"));
  const outputLibrary = otgAsLowerStringV36BP3F(formData.get("outputLibrary"));
  const galleryExclusionPolicy = otgAsLowerStringV36BP3F(formData.get("galleryExclusionPolicy"));
  const requestKind = otgValueFromFormDataV36BP3F(formData, ["requestKind", "kind", "jobKind"]);
  const sourceType = otgValueFromFormDataV36BP3F(formData, ["sourceType", "source", "origin"]);

  const explicitNoGallery =
    saveToGallery === "false" ||
    saveToGallerySnake === "false" ||
    persistToGallery === "false" ||
    addToGallery === "false" ||
    copyToGallery === "false" ||
    writeToGallery === "false" ||
    gallery === "false" ||
    skipGallery === "true" ||
    skipGeneralGallery === "true" ||
    assetLibraryOnly === "true" ||
    Boolean(galleryExclusionPolicy);

  const context = `${requestKind} ${sourceType} ${outputLibrary} ${galleryExclusionPolicy}`.toLowerCase();

  const creationCandidateContext =
    context.includes("character-builder-image") ||
    context.includes("characters-tab-builder") ||
    context.includes("characters-upload-fullbody-completion") ||
    context.includes("characters-tab-builder-upload-fullbody") ||
    context.includes("characters-8-angle-card") ||
    context.includes("character-card-only") ||
    context.includes("character-candidate") ||
    context.includes("characters-background-studio-preview") ||
    context.includes("characters-background-studio") ||
    context.includes("background-candidate") ||
    context.includes("background-studio-preview") ||
    context.includes("background-studio");

  return explicitNoGallery || creationCandidateContext;
}

function otgApplyNoGeneralGalleryPolicyToFormDataV36BP3F(formData: FormData | null | undefined): boolean {
  if (!formData) return false;
  const suppress = otgShouldSuppressGeneralGalleryFromFormDataV36BP3F(formData);
  if (!suppress) return false;

  formData.set("saveToGallery", "false");
  formData.set("save_to_gallery", "false");
  formData.set("persistToGallery", "false");
  formData.set("addToGallery", "false");
  formData.set("copyToGallery", "false");
  formData.set("writeToGallery", "false");
  formData.set("gallery", "false");
  formData.set("skipGallery", "true");
  formData.set("skipGeneralGallery", "true");
  formData.set("assetLibraryOnly", "true");
  formData.set("otgGeneralGallerySuppressedV36BP3F", "true");

  return true;
}

function otgRecordLowerV36BP3F(record: Record<string, unknown>, key: string): string {
  return otgAsLowerStringV36BP3F(record[key]);
}

function otgShouldSuppressGeneralGalleryFromRecordV36BP3F(record: Record<string, unknown>): boolean {
  const text = [
    record["requestKind"],
    record["kind"],
    record["jobKind"],
    record["sourceType"],
    record["source"],
    record["origin"],
    record["outputLibrary"],
    record["galleryExclusionPolicy"],
  ]
    .map((value) => (typeof value === "string" ? value : ""))
    .join(" ")
    .toLowerCase();

  const explicitNoGallery =
    record["saveToGallery"] === false ||
    record["save_to_gallery"] === false ||
    record["persistToGallery"] === false ||
    record["addToGallery"] === false ||
    record["copyToGallery"] === false ||
    record["writeToGallery"] === false ||
    record["gallery"] === false ||
    record["skipGallery"] === true ||
    record["skipGeneralGallery"] === true ||
    record["assetLibraryOnly"] === true ||
    otgRecordLowerV36BP3F(record, "saveToGallery") === "false" ||
    otgRecordLowerV36BP3F(record, "save_to_gallery") === "false" ||
    otgRecordLowerV36BP3F(record, "persistToGallery") === "false" ||
    otgRecordLowerV36BP3F(record, "addToGallery") === "false" ||
    otgRecordLowerV36BP3F(record, "copyToGallery") === "false" ||
    otgRecordLowerV36BP3F(record, "writeToGallery") === "false" ||
    otgRecordLowerV36BP3F(record, "gallery") === "false" ||
    otgRecordLowerV36BP3F(record, "skipGallery") === "true" ||
    otgRecordLowerV36BP3F(record, "skipGeneralGallery") === "true" ||
    otgRecordLowerV36BP3F(record, "assetLibraryOnly") === "true" ||
    Boolean(record["galleryExclusionPolicy"]);

  const creationCandidateContext =
    text.includes("character-builder-image") ||
    text.includes("characters-tab-builder") ||
    text.includes("characters-upload-fullbody-completion") ||
    text.includes("characters-tab-builder-upload-fullbody") ||
    text.includes("characters-8-angle-card") ||
    text.includes("character-card-only") ||
    text.includes("character-candidate") ||
    text.includes("characters-background-studio-preview") ||
    text.includes("characters-background-studio") ||
    text.includes("background-candidate") ||
    text.includes("background-studio-preview") ||
    text.includes("background-studio");

  return explicitNoGallery || creationCandidateContext;
}

function otgApplyNoGeneralGalleryPolicyToRecordV36BP3F(record: Record<string, unknown>): boolean {
  const suppress = otgShouldSuppressGeneralGalleryFromRecordV36BP3F(record);
  if (!suppress) return false;

  record["saveToGallery"] = false;
  record["save_to_gallery"] = false;
  record["persistToGallery"] = false;
  record["addToGallery"] = false;
  record["copyToGallery"] = false;
  record["writeToGallery"] = false;
  record["gallery"] = false;
  record["skipGallery"] = true;
  record["skipGeneralGallery"] = true;
  record["assetLibraryOnly"] = true;
  record["otgGeneralGallerySuppressedV36BP3F"] = true;

  return true;
}


export async function POST(req: NextRequest) {
  const deviceId = getDeviceIdFromReq(req);
  const descriptor = await peekWorkflowDescriptor(req);
  let route = configuredComfyBaseUrlForJob(descriptor);
  let videoSelection: Awaited<ReturnType<typeof selectVideoBackend>> | null = null;
  let manifestSelection: Awaited<ReturnType<typeof selectManifestBackend>> | null = null;
  let validatedVideoLoras: ValidatedVideoLora[] = [];
  let videoLoraRoutingOptions: VideoLoraRoutingOptions | undefined;
  if (route.kind === "video") {
    try {
      validatedVideoLoras = resolveVideoLoraSelections(
        descriptor.videoLoras,
        String(descriptor.workflowId || descriptor.preset || "")
      );
    } catch (error) {
      const failure = error instanceof VideoLoraCompatibilityError ? error : new VideoLoraCompatibilityError(String((error as Error)?.message || error));
      return Response.json({ ok: false, error: failure.message, code: failure.code }, { status: failure.status });
    }
    if (validatedVideoLoras.length) {
      const inventories = await fetchAllVideoLoraInventories();
      videoLoraRoutingOptions = {
        selectedLoras: validatedVideoLoras.map((selection) => ({ id: selection.id, displayName: selection.entry.displayName, filename: selection.entry.filename })),
        installedByBackend: Object.fromEntries(inventories.map((inventory) => [inventory.backendId, inventory.items.map((item) => item.exactFilename)])),
      };
    }
    videoSelection = await selectVideoBackend(descriptor as Record<string, unknown>, undefined, videoLoraRoutingOptions);
    if (!videoSelection.ok) {
      logVideoBackendJob("routing_rejected", {
        workflow: videoSelection.compatibility.id,
        error: videoSelection.error,
        manifestVersion: videoSelection.manifestVersion,
      });
      return Response.json(videoSelection, { status: videoSelection.status });
    }
    route = { kind: "video", baseUrl: videoSelection.backend.baseUrl };
  } else {
    manifestSelection = await selectManifestBackend(descriptor as Record<string, unknown>);
    if (!manifestSelection.ok) {
      console.info("[comfy-backend]", {
        event: "routing_rejected",
        workflow: "workflow" in manifestSelection ? manifestSelection.workflow?.id : null,
        error: manifestSelection.error,
        manifestVersion: manifestSelection.manifestVersion,
      });
      return Response.json(manifestSelection, { status: manifestSelection.status });
    }
    route = { kind: route.kind, baseUrl: manifestSelection.backend.url };
  }
  let COMFY_BASE_URL = route.baseUrl;
  const fallbackRequestClone = route.kind === "video" ? (req.clone() as NextRequest) : null;
  logComfyRouting("/api/comfy POST", descriptor, route);
  const comfyClientId = makeComfyClientId(deviceId);
  await waitForComfyClientProgressMonitor({ comfyBaseUrl: COMFY_BASE_URL, clientId: comfyClientId, timeoutMs: 1500 });

  let ownerCtx;
  try {
    ownerCtx = await getOwnerContext(req);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }

  const ownerKey = ownerCtx.ownerKey;
  void readState(ownerKey);

  let body: any = null;
  try {
    body = await parseOtgBody(req, COMFY_BASE_URL);
  } catch (e: any) {
    return Response.json(
      {
        ok: false,
        error: e?.message || "Invalid request body",
        stage: "parseOtgBody",
        detail: String(e?.stack || e?.message || e || ""),
      },
      { status: 400 }
    );
  }

  if (!body) {
    return Response.json(
      {
        ok: false,
        error: "Invalid request body",
        stage: "parseOtgBody",
      },
      { status: 400 }
    );
  }

  const normalizedRequestMeta = normalizeBodyRequestMeta(body);
  (body as any).title = normalizedRequestMeta.title;
  (body as any).workflowLabel = normalizedRequestMeta.workflowLabel;
  (body as any).requestKind = normalizedRequestMeta.requestKind;
  (body as any).extendRequestId = normalizedRequestMeta.extendRequestId;
  (body as any).sourceType = normalizedRequestMeta.sourceType;
  (body as any).extendedFromName = normalizedRequestMeta.extendedFromName;
  (body as any).extendSourceFrame = normalizedRequestMeta.extendSourceFrame;
  (body as any).extendMode = normalizedRequestMeta.extendMode;
  forceCharacterCardWorkflowIdentityV36BPR4(body);
  normalizeExplicitCreateVideoFromImagesRequest(body);

  if (route.kind === "video") {
    try {
      validatedVideoLoras = resolveVideoLoraSelections(
        (body as any).videoLoras,
        String((body as any).workflowId || (body as any).preset || "")
      );
    } catch (error) {
      const failure = error instanceof VideoLoraCompatibilityError ? error : new VideoLoraCompatibilityError(String((error as Error)?.message || error));
      return Response.json({ ok: false, error: failure.message, code: failure.code }, { status: failure.status });
    }
  }

  let graph: any = null;
  let otgMeta: any = undefined;

  if (!graph && typeof (body as any)?.promptJson === "string" && String((body as any).promptJson).trim()) {
    try {
      const parsed = JSON.parse(String((body as any).promptJson));
      if (parsed && typeof parsed === "object") {
        graph = (parsed as any).prompt && typeof (parsed as any).prompt === "object" ? (parsed as any).prompt : parsed;
      }
    } catch {
      // ignore
    }
  }

  if (!graph && (body as any).prompt && typeof (body as any).prompt === "object") {
    graph = (body as any).prompt;
  } else if (
    !graph &&
    (
      productionAnimateWorkflowFileForBody(body) ||
      (body as any).workflowFile ||
      (body as any).workflowPath ||
      (body as any).workflowJsonPath ||
      (body as any).workflowPresetPath
    )
  ) {
    const forcedProductionWorkflowFile = productionAnimateWorkflowFileForBody(body);
    const workflowFileRaw =
      forcedProductionWorkflowFile ||
      (body as any).workflowFile ||
      (body as any).workflowPath ||
      (body as any).workflowJsonPath ||
      (body as any).workflowPresetPath;

    const wf = loadPostedWorkflowJson(workflowFileRaw);
    if (!wf.ok) {
      return Response.json(
        { ok: false, error: wf.error, workflowFile: String(workflowFileRaw || ""), resolvedPath: wf.filePath },
        { status: wf.status }
      );
    }

    otgMeta = (wf.json as any)?.__otg;
    const extracted = extractPromptGraph(wf.json);
    if (!extracted.ok) {
      const fmt = (extracted as any).format;
      const fmtObj = fmt && typeof fmt === "object" ? fmt : {};
      return Response.json(
        { ok: false, error: extracted.error, ...fmtObj, gotKeys: (extracted as any).gotKeys, workflowFile: String(workflowFileRaw || ""), resolvedPath: wf.filePath },
        { status: 400 }
      );
    }

    const validated = validatePromptGraph(extracted.graph);
    if (!validated.ok) {
      const warnings = (validated as any).warnings ?? [];
      return Response.json({ ok: false, error: validated.error, warnings, workflowFile: String(workflowFileRaw || ""), resolvedPath: wf.filePath }, { status: 400 });
    }

    graph = extracted.graph;
    (body as any).workflowFile = String(workflowFileRaw || "");
    (body as any).resolvedWorkflowFile = wf.filePath;
  } else if (!graph && (body as any).preset) {
    const wf = loadWorkflowById(String((body as any).preset));
    if (!wf.ok) {
      return Response.json(
        { ok: false, error: `Preset not found: ${String((body as any).preset)}`, detail: wf.error },
        { status: wf.status }
      );
    }

    otgMeta = (wf.json as any)?.__otg;
    const extracted = extractPromptGraph(wf.json);
    if (!extracted.ok) {
      const fmt = (extracted as any).format;
      const fmtObj = fmt && typeof fmt === "object" ? fmt : {};
      return Response.json(
        { ok: false, error: extracted.error, ...fmtObj, gotKeys: (extracted as any).gotKeys },
        { status: 400 }
      );
    }

    const validated = validatePromptGraph(extracted.graph);
    if (!validated.ok) {
      const warnings = (validated as any).warnings ?? [];
      return Response.json({ ok: false, error: validated.error, warnings }, { status: 400 });
    }

    graph = extracted.graph;
  } else if (!graph && typeof body === "object") {
    graph = body;
  }

  if (!graph || typeof graph !== "object") {
    return Response.json({ ok: false, error: "Could not build prompt graph (missing preset or prompt graph)" }, { status: 400 });
  }

  const positive = String(
    (body as any).positivePrompt ??
      (typeof (body as any).prompt === "string" ? (body as any).prompt : undefined) ??
      (Array.isArray((body as any).prompts) ? (body as any).prompts[0] : undefined) ??
      ""
  );
  const negative = String((body as any).negativePrompt ?? (body as any).neg ?? "");
  const inputImages: string[] = Array.isArray((body as any).inputImages) ? (body as any).inputImages.map(String) : [];

  applyOtgPlaceholders(graph, { positive, negative, inputImages });
  const productionQwenStoryboardWorkflow = isProductionQwenStoryboardWorkflow(body, otgMeta);
  const referenceInputMapping = applyQwenStoryboardCharacterReferences(graph, body, otgMeta);

  const editImageWorkflow = isEditImageWorkflow(body, graph);
  if (editImageWorkflow && !productionQwenStoryboardWorkflow) {
    applyEditImageOverrides(graph, body);
  }

  if (positive || negative) {
    setTextEncodes(graph, positive, negative, otgMeta);
  }
  assertCharacterCandidateEditContract(graph, body);

  const krea2TurboWorkflow = isKrea2TurboWorkflow(body, graph);
  if (krea2TurboWorkflow) {
    applyKrea2TurboOverrides(graph, body);
  }

  const animeImagesWorkflow = isAnimeImagesWorkflow(body, graph);
  if (animeImagesWorkflow) {
    applyAnimeImagesOverrides(graph, body);
  }

  const wan22GenerateWorkflow = videoGenerateSelectionForWorkflowId(
    (body as any).workflowId || (body as any).preset
  );
  if (wan22GenerateWorkflow?.modelId === "wan22") {
    (body as any).durationSeconds = 5;
  }
  const skipSizeOverride =
    isLtxVideoWorkflow(body, graph) ||
    animeImagesWorkflow ||
    krea2TurboWorkflow ||
    wan22GenerateWorkflow?.modelId === "wan22";
  if (!skipSizeOverride) {
    const workflowIdHay = String((body as any).workflowId || "").toLowerCase();
    const isCreateImageWorkflow =
      workflowIdHay.includes("presets/create a picture") ||
      workflowIdHay.includes("create a picture") ||
      workflowIdHay.includes("create image") ||
      workflowIdHay.includes("create-picture");

    const wRaw = Number((body as any).width);
    const hRaw = Number((body as any).height);
    const wOk = Number.isFinite(wRaw);
    const hOk = Number.isFinite(hRaw);

    if (wOk && hOk) {
      const clamped = clampSizeToMaxPixels(Math.floor(wRaw), Math.floor(hRaw));
      setSize(graph, clamped.width, clamped.height);
    } else {
      const orient = String((body as any).orientation || "").toLowerCase();
      if (orient === "portrait" || orient === "landscape") {
        if (isCreateImageWorkflow) {
          setSize(graph, orient === "portrait" ? 720 : 1280, orient === "portrait" ? 1280 : 720);
        } else {
          const cur = inferAnySize(graph);
          if (cur) {
            const isPortrait = cur.height >= cur.width;
            const wantsPortrait = orient === "portrait";
            if (wantsPortrait !== isPortrait) {
              setSize(graph, cur.height, cur.width);
            }
          }
        }
      }
    }
  }

  const skipGenericFrameTimingOverrideV36BPU31 =
    animeImagesWorkflow ||
    wan22GenerateWorkflow?.modelId === "wan22" ||
    isProductionAnimateBranchSpecificTimingWorkflowV36BPU31(body);

  if (!skipGenericFrameTimingOverrideV36BPU31) {
    const frameCount = Number((body as any).frameCount);
    if (Number.isFinite(frameCount)) {
      const cf = clampFrames(Math.floor(frameCount));
      setFrameCount(graph, cf.frames);
    } else if (Number.isFinite(Number((body as any).durationSeconds))) {
      setDurationSeconds(graph, Math.floor(Number((body as any).durationSeconds)), otgMeta);
    }
  }

  const seedMode = (body as any).seedMode as any;
  const seedIn = (body as any).seed;
  const seedRes = setSeedAuto(graph, seedMode, seedIn);

  const ltxImageA =
    typeof (body as any).imageA === "string"
      ? (body as any).imageA
      : Array.isArray((body as any).inputImages)
        ? ((body as any).inputImages[0] ?? null)
        : null;

  const ltxImageB =
    typeof (body as any).imageB === "string"
      ? (body as any).imageB
      : Array.isArray((body as any).inputImages)
        ? ((body as any).inputImages[1] ?? null)
        : null;

  let wan22VideoSettings: ReturnType<typeof applyWan22GenerateOverrides> = null;
  if (animeImagesWorkflow) {
    applyAnimeImagesOverrides(graph, body);
  } else if (wan22GenerateWorkflow?.modelId === "wan22") {
    wan22VideoSettings = applyWan22GenerateOverrides(
      graph,
      body,
      { imageA: ltxImageA, imageB: ltxImageB }
    );
  } else if (!referenceInputMapping.usesDeclaredReferenceInputs) {
    applyLtx23Overrides(graph, body, {
      imageA: ltxImageA,
      imageB: ltxImageB,
      videoA: (body as any).videoA ?? null,
      audioA: (body as any).audioA ?? null,
    });
  }
  const ltxImageRuntimeBinding = assertCreateVideoFromImagesRuntimeBindingV1(
    graph,
    body as Record<string, any>,
    ltxImageA
  );
  if (ltxImageRuntimeBinding) {
    console.info("[video-image-binding]", ltxImageRuntimeBinding);
  }

  const otgImageModel = imageModelById(String((body as any).workflowId || (body as any).preset || ""));
  if (otgImageModel) {
    const otgOrientation = String((body as any).orientation || "portrait") === "landscape" ? "landscape" : "portrait";
    applyLockedImageSize(graph, otgOrientation);
    if (otgImageModel.operation === "edit") {
      applyEditImageReferences(graph, inputImages, otgImageModel.maxInputImages === 3 ? 3 : 1);
    }
  }

  const title = String((body as any)?.title || (body as any)?.name || "").trim();
  setFilenamePrefix__otg(graph, title);

  const loraChoices = Array.isArray((body as any).loras) ? (body as any).loras : null;
  let loraRes: any;
  if (otgImageModel) {
    if (loraChoices?.length) {
      const acknowledged = ["true", "1", "yes"].includes(String((body as any).loraAdultAcknowledged || "").toLowerCase());
      const acknowledgementVersion = String((body as any).loraAdultAcknowledgementVersion || "");
      if (!acknowledged || acknowledgementVersion !== IMAGE_LORA_ADULT_ACK_VERSION) {
        return Response.json(
          { ok: false, error: "LoRA access requires confirmation that the user is at least 18 years old and accepts responsibility for generated content." },
          { status: 400 }
        );
      }
    }
    const catalogModel = {
      ...otgImageModel,
      optionalLoras: readImageLoraCatalog().entries
        .filter((entry) => entry.enabled && entry.modelId === otgImageModel.id)
        .map(({ name, label, strength, mature, description, usage }) => ({ name, label, strength, mature, description, usage })),
    };
    loraRes = applyImageLoraSelections(graph, catalogModel, loraChoices);
    if (!loraRes.ok) {
      return Response.json({ ok: false, error: loraRes.error }, { status: 400 });
    }
    const selectedNames = (loraRes.selections || []).map((selection: any) => String(selection.name || "")).filter(Boolean);
    const availability = await validateLorasAvailableAtBackend(COMFY_BASE_URL, selectedNames);
    if (!availability.ok) {
      return Response.json(
        { ok: false, error: availability.error, missingLoras: availability.missing, backend: COMFY_BASE_URL },
        { status: 503 }
      );
    }
  } else {
    loraRes = applySelectedLoras(graph, loraChoices);
  }

  let videoLoraRes: ReturnType<typeof applyVideoLoras> | null = null;
  if (route.kind === "video") {
    try {
      videoLoraRes = applyVideoLoras(
        graph,
        String((body as any).workflowId || (body as any).preset || ""),
        validatedVideoLoras
      );
      graph = videoLoraRes.graph;
    } catch (error) {
      const failure = error instanceof VideoLoraCompatibilityError ? error : new VideoLoraCompatibilityError(String((error as Error)?.message || error), 409, "video_lora_patch_failed");
      return Response.json({ ok: false, error: failure.message, code: failure.code }, { status: failure.status });
    }
  }

  // OTG_WAN_RIFE_16_TO_24_V1
  // This runs after generic and workflow-specific duration overrides so the
  // final submitted WAN graph always uses native 16 FPS timing plus exact
  // alternating-pair RIFE interpolation to the 24 FPS container output.
  const wanRifeTiming = applyWanRifeFrameTiming(graph, body as Record<string, unknown>);
  if (wanRifeTiming.applied) {
    console.info("[wan-rife]", {
      durationSeconds: wanRifeTiming.durationSeconds,
      nativeFps: wanRifeTiming.nativeFps,
      nativeFrames: wanRifeTiming.nativeFrames,
      outputFps: wanRifeTiming.outputFps,
      outputFrames: wanRifeTiming.outputFrames,
      rifeNodeIds: wanRifeTiming.rifeNodeIds,
    });
  }

  let fallbackDebug: Record<string, unknown> | null = null;
  if (route.kind === "video" && videoSelection?.ok && videoSelection.fallbackActive) {
    const prepared = await prepareFallbackGraph(
      { ...(descriptor as Record<string, unknown>), ...(body as Record<string, unknown>) },
      graph,
      videoLoraRoutingOptions
    );
    if (!prepared.ok) {
      logVideoBackendJob("fallback_validation_rejected", {
        workflow: prepared.compatibility.id,
        validation: "validation" in prepared ? prepared.validation : null,
      });
      return Response.json(prepared, { status: prepared.status });
    }
    graph = prepared.graph;
    fallbackDebug = {
      compatibilityMode: prepared.compatibility.mode,
      reductionsApplied: prepared.reductionsApplied,
      validation: prepared.validation,
    };
  }

  try {
    const ah = Number((body as any).angleHorizontal);
    const av = Number((body as any).angleVertical);
    const az = Number((body as any).angleZoom);
    const adpRaw = String((body as any).angleDefaultPrompts ?? "").toLowerCase();
    const acvRaw = String((body as any).angleCameraView ?? "").toLowerCase();
    const adp = adpRaw === "true" || adpRaw === "1" || adpRaw === "yes";
    const acv = acvRaw === "true" || acvRaw === "1" || acvRaw === "yes";

    const node93: any = (graph as any)?.["93"];
    if (node93?.class_type === "QwenMultiangleCameraNode" && node93?.inputs) {
      if (Number.isFinite(ah)) node93.inputs.horizontal_angle = Math.max(0, Math.min(360, Math.floor(ah)));
      if (Number.isFinite(av)) node93.inputs.vertical_angle = Math.max(0, Math.min(360, Math.floor(av)));
      if (Number.isFinite(az)) node93.inputs.zoom = Math.max(1, Math.min(10, az));
      if (adpRaw) node93.inputs.default_prompts = adp;
      if (acvRaw) node93.inputs.camera_view = acv;
    }
  } catch {
    // ignore
  }

  try {
    markRunning(ownerKey, {
      title: title || null,
      workflowId: String((body as any).preset || (body as any).workflowId || "").trim() || null,
      deviceId,
      comfyClientId,
      comfyBaseUrl: COMFY_BASE_URL,
      totalNodes: graph && typeof graph === "object" ? Object.keys(graph).length : null,
      positivePrompt: String((body as any).positivePrompt ?? (body as any).prompt ?? "").trim() || null,
      negativePrompt: String((body as any).negativePrompt ?? (body as any).neg ?? "").trim() || null,
      submitPayload: {
        preset: String((body as any).preset || (body as any).workflowId || "").trim() || null,
        workflowId: String((body as any).workflowId || (body as any).preset || "").trim() || null,
        positivePrompt: String((body as any).positivePrompt ?? (body as any).prompt ?? "") || "",
        negativePrompt: String((body as any).negativePrompt ?? (body as any).neg ?? "") || "",
        characterContinuityPrompt: (body as any).characterContinuityPrompt ?? null,
        selectedCharacterIdentities: (body as any).selectedCharacterIdentities ?? null,
        videoLoras: publicVideoLoraSelectionMetadata(validatedVideoLoras),
        loras: (body as any).loras ?? null,
        orientation: (body as any).orientation ?? null,
        durationSec: (body as any).durationSeconds ?? (body as any).durationSec ?? (body as any).seconds ?? null,
        seed: (body as any).seed ?? null,
        width: (body as any).width ?? null,
        height: (body as any).height ?? null,
        gpuTarget: (body as any).gpuTarget ?? null,
        workflowLabel: (body as any).workflowLabel ?? null,
        requestKind: (body as any).requestKind ?? null,
        extendRequestId: (body as any).extendRequestId ?? null,
        sourceType: (body as any).sourceType ?? ((body as any).requestKind === "gallery-extend" ? "gallery-extend" : null),
        loadImageNodeId: (body as any).loadImageNodeId ?? null,
        saveImageNodeId: (body as any).saveImageNodeId ?? null,
        filenamePrefix: (body as any).filenamePrefix ?? null,
        filename_prefix: (body as any).filename_prefix ?? null,
        saveToGallery: (body as any).saveToGallery ?? null,
        save_to_gallery: (body as any).save_to_gallery ?? null,
        persistToGallery: (body as any).persistToGallery ?? null,
        addToGallery: (body as any).addToGallery ?? null,
        copyToGallery: (body as any).copyToGallery ?? null,
        writeToGallery: (body as any).writeToGallery ?? null,
        gallery: (body as any).gallery ?? null,
        skipGallery: (body as any).skipGallery ?? null,
        skipGeneralGallery: (body as any).skipGeneralGallery ?? null,
        assetLibraryOnly: (body as any).assetLibraryOnly ?? null,
        outputLibrary: (body as any).outputLibrary ?? null,
        galleryExclusionPolicy: (body as any).galleryExclusionPolicy ?? null,
        extendedFromName: (body as any).extendedFromName ?? null,
        extendSourceFrame: (body as any).extendSourceFrame ?? null,
        extendMode: (body as any).extendMode ?? null,
      },
    });
  } catch {
    // best-effort only
  }

  let upstream: Response;
  try {
    upstream = await submitComfyPromptWith5060Lease({
      baseUrl: COMFY_BASE_URL,
      workerId: "api-comfy",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: graph, client_id: comfyClientId }),
      },
    });
  } catch (error: any) {
    // A network error after dispatch is ambiguous: ComfyUI may have accepted the
    // prompt before the connection failed. Never retry on another GPU here.
    logVideoBackendJob("submission_ambiguous_no_retry", { backend: COMFY_BASE_URL, error: String(error?.message || error) });
    return Response.json(
      { ok: false, error: "Video submission result is unknown; automatic fallback was not attempted to prevent duplicate generation." },
      { status: 502 }
    );
  }

  let text = await upstream.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  if (!upstream.ok) {
    logVideoBackendJob("submission_rejected", {
      backend: COMFY_BASE_URL,
      gpu: videoSelection?.ok ? videoSelection.backend.gpu : null,
      upstreamStatus: upstream.status,
    });
    const canTryFallback = shouldAttemptVideoSubmissionFallback({
      routeKind: route.kind,
      selectionOk: Boolean(videoSelection?.ok),
      backendId: videoSelection?.ok ? videoSelection.backend.id : null,
      hasFallbackRequestClone: Boolean(fallbackRequestClone),
      upstreamStatus: upstream.status,
    });
    if (!canTryFallback || !fallbackRequestClone) {
      return Response.json({ ok: false, upstreamStatus: upstream.status, response: parsed }, { status: upstream.status });
    }

    const prepared = await prepareFallbackGraph(
      { ...(descriptor as Record<string, unknown>), ...(body as Record<string, unknown>) },
      graph,
      videoLoraRoutingOptions
    );
    const fallbackBackend = videoBackends().fallback;
    const fallbackProbe = await probeVideoBackend(fallbackBackend.baseUrl);
    if (!prepared.ok || !fallbackProbe.ok) {
      return Response.json(
        prepared.ok
          ? { ok: false, upstreamStatus: upstream.status, response: parsed, error: "RTX 5060 Ti fallback is unavailable." }
          : prepared,
        { status: prepared.ok ? 503 : prepared.status }
      );
    }
    const primaryProbe = videoSelection!.primaryProbe;

    // Replaying the cloned multipart request uploads the same deterministic names
    // with overwrite=true to the fallback. No prompt is submitted by this step.
    await parseOtgBody(fallbackRequestClone, fallbackBackend.baseUrl);
    graph = prepared.graph;
    fallbackDebug = {
      compatibilityMode: prepared.compatibility.mode,
      reductionsApplied: prepared.reductionsApplied,
      validation: prepared.validation,
      primaryRejectedStatus: upstream.status,
    };
    COMFY_BASE_URL = fallbackBackend.baseUrl;
    try {
      upstream = await submitComfyPromptWith5060Lease({
        baseUrl: COMFY_BASE_URL,
        workerId: "api-comfy-video-fallback",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: graph, client_id: comfyClientId }),
        },
      });
    } catch (error: any) {
      logVideoBackendJob("fallback_submission_ambiguous_no_retry", { backend: COMFY_BASE_URL, error: String(error?.message || error) });
      return Response.json(
        { ok: false, error: "Fallback submission result is unknown; no further retry was attempted." },
        { status: 502 }
      );
    }
    text = await upstream.text();
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    if (!upstream.ok) {
      return Response.json({ ok: false, upstreamStatus: upstream.status, response: parsed }, { status: upstream.status });
    }
    videoSelection = {
      ok: true,
      backend: fallbackBackend,
      fallbackActive: true,
      fallbackReason: `RTX 3090 rejected the request with HTTP ${fallbackDebug.primaryRejectedStatus}.`,
      compatibility: prepared.compatibility,
      graph,
      reductionsApplied: prepared.reductionsApplied,
      primaryProbe,
      fallbackProbe,
      validation: prepared.validation,
      workflowCapability: videoSelection!.workflowCapability,
      manifestVersion: videoSelection!.manifestVersion,
    };
  }

  if (route.kind === "video") {
    logVideoBackendJob("submission_accepted", {
      backendId: videoSelection?.ok ? videoSelection.backend.id : null,
      backend: COMFY_BASE_URL,
      gpu: videoSelection?.ok ? videoSelection.backend.gpu : null,
      promptId: String((parsed as any)?.prompt_id || "") || null,
      fallbackActive: videoSelection?.ok ? videoSelection.fallbackActive : false,
      selectionReason: videoSelection?.ok
        ? (videoSelection.fallbackActive ? "primary_unavailable_verified_fallback" : "primary_healthy_verified")
        : null,
      fallbackReason: videoSelection?.ok ? videoSelection.fallbackReason : null,
      endpoint: COMFY_BASE_URL,
      manifestVersion: videoSelection?.ok ? videoSelection.manifestVersion : null,
      videoLoras: publicVideoLoraSelectionMetadata(validatedVideoLoras),
    });
  }

  let promptMetaPath: string | null = null;

  try {
    ensureDir(JOBS_DIR);
    const jobPath = path.join(JOBS_DIR, `${deviceId}.jsonl`);
    const prompt_id = String((parsed as any)?.prompt_id || "").trim() || null;

    try {
      if (prompt_id) {
        recordComfyPromptSubmitted({
          promptId: prompt_id,
          ownerKey,
          deviceId,
          clientId: comfyClientId,
          comfyBaseUrl: COMFY_BASE_URL,
          totalNodes: graph && typeof graph === "object" ? Object.keys(graph).length : null,
        });
        ensureComfyClientProgressMonitor({ comfyBaseUrl: COMFY_BASE_URL, clientId: comfyClientId });
        writeState(ownerKey, {
          promptId: prompt_id,
          status: "running",
          error: null,
          comfyClientId,
          comfyBaseUrl: COMFY_BASE_URL,
          totalNodes: graph && typeof graph === "object" ? Object.keys(graph).length : null,
          progressPercent: 0,
          progressUpdatedAt: Date.now(),
        });
        const promptMeta = writePromptRequestMeta(ownerKey, prompt_id, {
          username: ownerCtx.username ?? null,
          deviceId,
          title: title || null,
          workflowId: String((body as any).workflowId || (body as any).preset || "").trim() || null,
          workflowLabel: (body as any).workflowLabel ?? null,
          requestKind: (body as any).requestKind ?? null,
          extendRequestId: (body as any).extendRequestId ?? null,
          sourceType: (body as any).sourceType ?? ((body as any).requestKind === "gallery-extend" ? "gallery-extend" : null),
          extendedFromName: (body as any).extendedFromName ?? null,
          extendSourceFrame: (body as any).extendSourceFrame ?? null,
          extendMode: (body as any).extendMode ?? null,
          positivePrompt: (body as any).positivePrompt ?? null,
          negativePrompt: (body as any).negativePrompt ?? null,
          videoLoras: publicVideoLoraSelectionMetadata(validatedVideoLoras),
          submitPayload: {
            preset: (body as any).preset ?? (body as any).workflowId ?? null,
            workflowId: (body as any).workflowId ?? (body as any).preset ?? null,
            videoLoras: publicVideoLoraSelectionMetadata(validatedVideoLoras),
          positivePrompt: (body as any).positivePrompt ?? null,
          negativePrompt: (body as any).negativePrompt ?? null,
          characterContinuityPrompt: (body as any).characterContinuityPrompt ?? null,
          selectedCharacterIdentities: (body as any).selectedCharacterIdentities ?? null,
          workflowLabel: (body as any).workflowLabel ?? null,
            title: title || null,
            requestKind: (body as any).requestKind ?? null,
            extendRequestId: (body as any).extendRequestId ?? null,
            sourceType: (body as any).sourceType ?? ((body as any).requestKind === "gallery-extend" ? "gallery-extend" : null),
            loadImageNodeId: (body as any).loadImageNodeId ?? null,
            saveImageNodeId: (body as any).saveImageNodeId ?? null,
            filenamePrefix: (body as any).filenamePrefix ?? null,
            filename_prefix: (body as any).filename_prefix ?? null,
            saveToGallery: (body as any).saveToGallery ?? null,
            save_to_gallery: (body as any).save_to_gallery ?? null,
            persistToGallery: (body as any).persistToGallery ?? null,
            addToGallery: (body as any).addToGallery ?? null,
            copyToGallery: (body as any).copyToGallery ?? null,
            writeToGallery: (body as any).writeToGallery ?? null,
            gallery: (body as any).gallery ?? null,
            skipGallery: (body as any).skipGallery ?? null,
            skipGeneralGallery: (body as any).skipGeneralGallery ?? null,
            assetLibraryOnly: (body as any).assetLibraryOnly ?? null,
            outputLibrary: (body as any).outputLibrary ?? null,
            galleryExclusionPolicy: (body as any).galleryExclusionPolicy ?? null,
            extendedFromName: (body as any).extendedFromName ?? null,
            extendSourceFrame: (body as any).extendSourceFrame ?? null,
            extendMode: (body as any).extendMode ?? null,
          },
        });
        promptMetaPath = promptMeta.filePath;
      }
    } catch {
      // best-effort only
    }

    fs.appendFileSync(
      jobPath,
      JSON.stringify({
        ts: Date.now(),
        ownerKey,
        username: ownerCtx.username ?? null,
        deviceId,
        title: title || null,
        workflowLabel: (body as any).workflowLabel ?? null,
        requestKind: (body as any).requestKind ?? null,
        extendRequestId: (body as any).extendRequestId ?? null,
        sourceType: (body as any).sourceType ?? ((body as any).requestKind === "gallery-extend" ? "gallery-extend" : null),
        extendedFromName: (body as any).extendedFromName ?? null,
        extendSourceFrame: (body as any).extendSourceFrame ?? null,
        extendMode: (body as any).extendMode ?? null,
        preset: (body as any).preset ?? (body as any).workflowId ?? null,
        prompts: Array.isArray((body as any).prompts) ? (body as any).prompts : null,
        positivePrompt: (body as any).positivePrompt ?? null,
        negativePrompt: (body as any).negativePrompt ?? null,
        characterContinuityPrompt: (body as any).characterContinuityPrompt ?? null,
        selectedCharacterIdentities: (body as any).selectedCharacterIdentities ?? null,
        loras: Array.isArray((body as any).loras) ? (body as any).loras : null,
        videoLoras: publicVideoLoraSelectionMetadata(validatedVideoLoras),
        videoLorasApplied: videoLoraRes?.applied ?? [],
        lorasApplied: (loraRes as any)?.applied ?? null,
        lorasAvailable: (loraRes as any)?.available ?? null,
        seed: (seedRes as any)?.seed ?? null,
        prompt_id,
        comfyClientId,
        comfyBaseUrl: COMFY_BASE_URL,
        rawResponse: parsed,
        promptMetaPath,
        submitPayload: {
          preset: (body as any).preset ?? (body as any).workflowId ?? null,
          workflowId: (body as any).workflowId ?? (body as any).preset ?? null,
          prompts: Array.isArray((body as any).prompts) ? (body as any).prompts : null,
          positivePrompt: (body as any).positivePrompt ?? null,
          negativePrompt: (body as any).negativePrompt ?? null,
          characterContinuityPrompt: (body as any).characterContinuityPrompt ?? null,
          selectedCharacterIdentities: (body as any).selectedCharacterIdentities ?? null,
          loras: Array.isArray((body as any).loras) ? (body as any).loras : null,
          videoLoras: publicVideoLoraSelectionMetadata(validatedVideoLoras),
          videoLorasApplied: videoLoraRes?.applied ?? [],
          lorasApplied: (loraRes as any)?.applied ?? null,
          lorasAvailable: (loraRes as any)?.available ?? null,
          seed: (seedRes as any)?.seed ?? null,
          title: title || "",
          width: Number.isFinite(Number((body as any).width)) ? Math.floor(Number((body as any).width)) : null,
          height: Number.isFinite(Number((body as any).height)) ? Math.floor(Number((body as any).height)) : null,
          durationSeconds: Number.isFinite(Number((body as any).durationSeconds))
            ? Math.floor(Number((body as any).durationSeconds))
            : null,
          frameCount: Number.isFinite(Number((body as any).frameCount))
            ? Math.floor(Number((body as any).frameCount))
            : null,
          orientation: (body as any).orientation ?? null,
          gpuTarget: (body as any).gpuTarget ?? null,
          workflowLabel: (body as any).workflowLabel ?? null,
          requestKind: (body as any).requestKind ?? null,
          extendRequestId: (body as any).extendRequestId ?? null,
          sourceType: (body as any).sourceType ?? ((body as any).requestKind === "gallery-extend" ? "gallery-extend" : null),
          loadImageNodeId: (body as any).loadImageNodeId ?? null,
          saveImageNodeId: (body as any).saveImageNodeId ?? null,
          filenamePrefix: (body as any).filenamePrefix ?? null,
          filename_prefix: (body as any).filename_prefix ?? null,
          saveToGallery: (body as any).saveToGallery ?? null,
          save_to_gallery: (body as any).save_to_gallery ?? null,
          persistToGallery: (body as any).persistToGallery ?? null,
          addToGallery: (body as any).addToGallery ?? null,
          copyToGallery: (body as any).copyToGallery ?? null,
          writeToGallery: (body as any).writeToGallery ?? null,
          gallery: (body as any).gallery ?? null,
          skipGallery: (body as any).skipGallery ?? null,
          skipGeneralGallery: (body as any).skipGeneralGallery ?? null,
          assetLibraryOnly: (body as any).assetLibraryOnly ?? null,
          outputLibrary: (body as any).outputLibrary ?? null,
          galleryExclusionPolicy: (body as any).galleryExclusionPolicy ?? null,
          extendedFromName: (body as any).extendedFromName ?? null,
          extendSourceFrame: (body as any).extendSourceFrame ?? null,
          extendMode: (body as any).extendMode ?? null,
          prompt: (body as any).prompt && typeof (body as any).prompt === "object" ? (body as any).prompt : null,
        },
      }) + "\n",
      "utf-8"
    );
  } catch {
    // don't fail job submission if persistence fails
  }

  return Response.json(
    {
      ...parsed,
      videoBackend: route.kind === "video" && videoSelection?.ok ? {
        id: videoSelection.backend.id,
        label: videoSelection.backend.label,
        gpu: videoSelection.backend.gpu,
        baseUrl: COMFY_BASE_URL,
        fallbackActive: videoSelection.fallbackActive,
        fallbackReason: videoSelection.fallbackReason,
        ...fallbackDebug,
      } : null,
      videoSettings: wan22VideoSettings,
      otgRequestDebug: {
        workflowId: (body as any).workflowId ?? (body as any).preset ?? null,
        workflowLabel: (body as any).workflowLabel ?? null,
        workflowFile: (body as any).workflowFile ?? null,
        workflowPath: (body as any).workflowPath ?? null,
        resolvedWorkflowFile: (body as any).resolvedWorkflowFile ?? null,
        loadedGraphSource: (body as any).resolvedWorkflowFile ? "workflowFile" : ((body as any).promptJson ? "promptJson" : "workflowRegistry"),
        title: (body as any).title ?? null,
        requestKind: (body as any).requestKind ?? null,
        extendRequestId: (body as any).extendRequestId ?? null,
        sourceType: (body as any).sourceType ?? null,
        extendedFromName: (body as any).extendedFromName ?? null,
        extendSourceFrame: (body as any).extendSourceFrame ?? null,
        extendMode: (body as any).extendMode ?? null,
        hasOtgMeta: !!((body as any).requestKind || (body as any).extendRequestId || (body as any).extendedFromName || (body as any).extendSourceFrame || (body as any).extendMode),
        promptMetaPath,
        referenceInputMapping,
        characterContinuityPrompt: (body as any).characterContinuityPrompt ?? null,
        selectedCharacterIdentities: (body as any).selectedCharacterIdentities ?? null,
        videoSettings: wan22VideoSettings,
        ltxImageRuntimeBinding,
        videoLoras: publicVideoLoraSelectionMetadata(validatedVideoLoras),
        videoLorasApplied: videoLoraRes?.applied ?? [],
      },
    },
    { status: 200 },
  );
}
