import { NextRequest } from "next/server";
import { isLikelyVideoWorkflowKey } from "@/app/api/_lib/comfyTarget";
import path from "node:path";
import fs from "node:fs";
import { loadWorkflowById, extractPromptGraph, validatePromptGraph } from "@/lib/workflows";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { readState, markRunning, writeState } from "@/lib/contentState";
import { writePromptRequestMeta } from "@/lib/promptRequestMeta";
import { ensureComfyClientProgressMonitor, recordComfyPromptSubmitted, waitForComfyClientProgressMonitor } from "@/lib/comfyProgress";

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


function normalizeComfyBaseUrl(raw: unknown): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  return value.replace(/\/+$/, "");
}

function firstComfyBaseUrl(...values: Array<unknown>): string | null {
  for (const value of values) {
    const normalized = normalizeComfyBaseUrl(value);
    if (normalized) return normalized;
  }
  return null;
}

function configuredImageComfyBaseUrl(): string {
  return (
    firstComfyBaseUrl(
      process.env.OTG_IMAGE_COMFY_BASE_URL,
      process.env.IMAGE_COMFY_BASE_URL,
      process.env.COMFY_IMAGE_BASE_URL,
      process.env.NEXT_PUBLIC_IMAGE_COMFY_BASE_URL,
      process.env.OTG_COMFY_BASE_URL,
      process.env.COMFY_BASE_URL,
      process.env.COMFYUI_BASE_URL,
      process.env.NEXT_PUBLIC_COMFY_BASE_URL,
      process.env.NEXT_PUBLIC_COMFYUI_BASE_URL
    ) || "http://127.0.0.1:8288"
  );
}

function configuredVideoComfyBaseUrl(): string {
  return (
    firstComfyBaseUrl(
      process.env.OTG_VIDEO_COMFY_BASE_URL,
      process.env.VIDEO_COMFY_BASE_URL,
      process.env.COMFY_VIDEO_BASE_URL,
      process.env.NEXT_PUBLIC_VIDEO_COMFY_BASE_URL,
      process.env.OTG_COMFY_BASE_URL,
      process.env.COMFY_BASE_URL,
      process.env.COMFYUI_BASE_URL,
      process.env.NEXT_PUBLIC_COMFY_BASE_URL,
      process.env.NEXT_PUBLIC_COMFYUI_BASE_URL,
      configuredImageComfyBaseUrl()
    ) || "http://127.0.0.1:8288"
  );
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


async function peekWorkflowDescriptor(req: NextRequest): Promise<{ preset: string; label: string }> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  if (!ct.includes("multipart/form-data")) {
    try {
      const body = await req.clone().json();
      return {
        preset: String(body?.preset || body?.workflowId || body?.id || "").trim(),
        label: String(body?.label || body?.workflowLabel || body?.workflowName || "").trim(),
      };
    } catch {
      return { preset: "", label: "" };
    }
  }

  try {
    const fd = await req.clone().formData();
    return {
      preset: String(fd.get("workflowId") || fd.get("preset") || "").trim(),
      label: String(fd.get("label") || fd.get("workflowLabel") || fd.get("workflowName") || "").trim(),
    };
  } catch {
    return { preset: "", label: "" };
  }
}
function workflowKey(body: any) {
  const id = String(body?.preset || body?.workflowId || body?.id || "").trim().toLowerCase();
  const label = String(body?.label || body?.workflowLabel || body?.workflowName || "").trim().toLowerCase();
  return `${id} ${label}`.trim();
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

  const setPromptPair = () => {
    const positiveText = String(body?.positivePrompt || body?.prompt || "");
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
    key.includes("presets/create first image to last image video") ||
    key.includes("first image to last image") ||
    key.includes("first to last image")
  ) {
    const positiveText = String(body?.positivePrompt || body?.prompt || "");
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
    key.includes("presets/create a video from pictures") ||
    key.includes("presets/create a video from images") ||
    key.includes("create a video with picture")
  ) {
    setPromptPair();
    if (assets.imageA) {
      // Current LTX 2.3 v1.1 I2V graph.
      setNodeIfPresent(graph, "187", { image: assets.imageA });

      // Older/alternate I2V graphs.
      setNodeIfPresent(graph, "149", { image: assets.imageA });
      setNodeIfPresent(graph, "240", { image: assets.imageA });
      setFirstLoadImageNode(graph, assets.imageA);
    }
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
  const positivePrompt = String(fd.get("prompt") || fd.get("positivePrompt") || otgMeta?.positivePrompt || "");
  const negativePrompt = String(fd.get("negativePrompt") || otgMeta?.negativePrompt || "");
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
  const extendedFromName = String(fd.get("extendedFromName") || otgMeta?.extendedFromName || "").trim();
  const extendSourceFrame = String(fd.get("extendSourceFrame") || otgMeta?.extendSourceFrame || "").trim();
  const extendMode = String(fd.get("extendMode") || otgMeta?.extendMode || "").trim();

  const lorasRaw = fd.get("loras");
  let loras: any = null;
  if (typeof lorasRaw === "string" && lorasRaw.trim()) {
    try {
      const parsed = JSON.parse(lorasRaw);
      if (Array.isArray(parsed)) loras = parsed;
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
      const name = serverPath
        ? await uploadServerImagePathToComfy(serverPath, comfyBaseUrl)
        : await uploadFormFileToComfy(v as File, comfyBaseUrl, "image");
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
    sourceType: requestMeta.sourceType,
    extendedFromName: requestMeta.extendedFromName,
    extendSourceFrame: requestMeta.extendSourceFrame,
    extendMode: requestMeta.extendMode,
  };
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
  const negativeText = String(body?.negativePrompt || body?.neg || "").trim();

  if (positiveText) setNodeIfPresent(graph, "435", { value: positiveText });

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
  const workflowLooksVideo = mode === "video" || isLikelyVideoWorkflowKey(preset, label);
  const comfyBaseUrl = workflowLooksVideo ? configuredVideoComfyBaseUrl() : configuredImageComfyBaseUrl();

  try {
    const r = await fetch(`${comfyBaseUrl}/system_stats`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
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

export async function POST(req: NextRequest) {
  const deviceId = getDeviceIdFromReq(req);
  const descriptor = await peekWorkflowDescriptor(req);
  const workflowLooksVideo = isLikelyVideoWorkflowKey(descriptor.preset, descriptor.label);
  const COMFY_BASE_URL = workflowLooksVideo ? configuredVideoComfyBaseUrl() : configuredImageComfyBaseUrl();
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

  const animeImagesWorkflow = isAnimeImagesWorkflow(body, graph);
  if (animeImagesWorkflow) {
    applyAnimeImagesOverrides(graph, body);
  }

  const skipSizeOverride = isLtxVideoWorkflow(body, graph) || animeImagesWorkflow;
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

  if (!animeImagesWorkflow) {
    const frameCount = Number((body as any).frameCount);
    if (!animeImagesWorkflow && Number.isFinite(frameCount)) {
      const cf = clampFrames(Math.floor(frameCount));
      setFrameCount(graph, cf.frames);
    } else if (!animeImagesWorkflow && Number.isFinite(Number((body as any).durationSeconds))) {
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

  if (animeImagesWorkflow) {
    applyAnimeImagesOverrides(graph, body);
  } else if (!referenceInputMapping.usesDeclaredReferenceInputs) {
    applyLtx23Overrides(graph, body, {
      imageA: ltxImageA,
      imageB: ltxImageB,
      videoA: (body as any).videoA ?? null,
      audioA: (body as any).audioA ?? null,
    });
  }

  const title = String((body as any)?.title || (body as any)?.name || "").trim();
  setFilenamePrefix__otg(graph, title);

  const loraChoices = Array.isArray((body as any).loras) ? (body as any).loras : null;
  const loraRes = applySelectedLoras(graph, loraChoices);

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
        extendedFromName: (body as any).extendedFromName ?? null,
        extendSourceFrame: (body as any).extendSourceFrame ?? null,
        extendMode: (body as any).extendMode ?? null,
      },
    });
  } catch {
    // best-effort only
  }

  const upstream = await fetch(`${COMFY_BASE_URL}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: comfyClientId }),
  });

  const text = await upstream.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  if (!upstream.ok) {
    return Response.json({ ok: false, upstreamStatus: upstream.status, response: parsed }, { status: upstream.status });
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
          submitPayload: {
            preset: (body as any).preset ?? (body as any).workflowId ?? null,
            workflowId: (body as any).workflowId ?? (body as any).preset ?? null,
            positivePrompt: (body as any).positivePrompt ?? null,
            negativePrompt: (body as any).negativePrompt ?? null,
            workflowLabel: (body as any).workflowLabel ?? null,
            title: title || null,
            requestKind: (body as any).requestKind ?? null,
            extendRequestId: (body as any).extendRequestId ?? null,
            sourceType: (body as any).sourceType ?? ((body as any).requestKind === "gallery-extend" ? "gallery-extend" : null),
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
        loras: Array.isArray((body as any).loras) ? (body as any).loras : null,
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
          loras: Array.isArray((body as any).loras) ? (body as any).loras : null,
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
      otgRequestDebug: {
        workflowId: (body as any).workflowId ?? (body as any).preset ?? null,
        workflowLabel: (body as any).workflowLabel ?? null,
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
      },
    },
    { status: 200 },
  );
}
