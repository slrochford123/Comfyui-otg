function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}

import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { loadWorkflowById, extractPromptGraph, validatePromptGraph } from "@/lib/workflows";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { readState, markRunning } from "@/lib/contentState";
function sanitizeComfyPromptGraph(graph: any) {
  const out: Record<string, any> = {};
  if (!graph || typeof graph !== "object") return out;

  for (const [id, node] of Object.entries(graph)) {
    if (!/^\d+$/.test(id)) continue;      // drop _otg_meta and non-node keys
    if (!node || typeof node !== "object") continue;
    if (!("class_type" in node)) continue;
    out[id] = node;
  }
  return out;
}

export const runtime = "nodejs";

const COMFY_BASE_URL =
  (process.env.COMFY_BASE_URL || process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");

const OTG_DATA_DIR = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
const JOBS_DIR = path.join(OTG_DATA_DIR, "device_jobs");

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


function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function setTextEncodes(
  graph: any,
  positive: string,
  negative: string,
  otgMeta?: any,
) {
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
    // Try a few common key names
    if (assign(node, ["text", "prompt", "caption", "positive", "positive_prompt"], positive)) return;
    // If the node has string inputs, set the first one
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

  // 1) Explicit mapping in workflow JSON (__otg)
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

  // 2) Graph-based heuristic: find \"positive\" / \"negative\" input connections
  const posTargets = new Set<string>();
  const negTargets = new Set<string>();

  for (const [_, node] of Object.entries(nodes)) {
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

  // 3) Fallback: set the first 1-2 TextEncode-like nodes that expose a string input
  const textLike = Object.entries(nodes)
    .map(([id, node]) => ({ id, node: node as any }))
    .filter((x) => x?.node?.inputs && (typeof x.node.inputs.text === "string" || typeof x.node.inputs.prompt === "string"))
    .filter((x) => /textencode|cliptextencode|t5|prompt/i.test(String(x.node.class_type || "")));

  if (textLike[0]) setPositiveOnNode(textLike[0].id);
  if (textLike[1]) setNegativeOnNode(textLike[1].id);
}



function setSeed(graph: any, seed: number) {
  if (!graph || typeof graph !== "object") return;
  if (!Number.isFinite(seed)) return;

  for (const node of Object.values(graph) as any[]) {
    if (!node?.inputs) continue;
    if (typeof node.inputs.seed === "number") node.inputs.seed = seed;
    if (typeof node.inputs.noise_seed === "number") node.inputs.noise_seed = seed;
  }
}

function setFilenamePrefix(graph: any, prefix: string) {
  if (!graph || typeof graph !== "object") return;
  const p = String(prefix || "").trim();
  if (!p) return;
  for (const node of Object.values(graph) as any[]) {
    if (!node?.inputs) continue;
    if (typeof node.inputs.filename_prefix === "string") {
      node.inputs.filename_prefix = p;
    }
  }
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

function setDurationSeconds(graph: any, seconds: number) {
  if (!graph || typeof graph !== "object") return;
  if (!Number.isFinite(seconds)) return;
  const sec = Math.max(0, Math.min(30, Math.floor(seconds)));

  // Try to infer fps from the graph if present; otherwise default to 8.
  let fps = 8;
  for (const node of Object.values(graph) as any[]) {
    const v = node?.inputs?.fps ?? node?.inputs?.frame_rate ?? node?.inputs?.framerate;
    if (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 120) {
      fps = Math.floor(v);
      break;
    }
  }

  const frames = Math.max(1, sec === 0 ? 1 : sec * fps);
  const frameKeys = [
    "num_frames",
    "frames",
    "frame_count",
    "n_frames",
    "length",
    "video_length",
    "max_frames",
  ];

  for (const node of Object.values(graph) as any[]) {
    if (!node?.inputs) continue;
    for (const k of frameKeys) {
      if (typeof node.inputs?.[k] === "number") node.inputs[k] = frames;
    }
  }
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

      // Image placeholders:
      // - __OTG_INPUT_IMAGE__ (sequential)
      // - __OTG_INPUT_IMAGE_1__ (1-based explicit index)
      const m = v.match(/^__OTG_INPUT_IMAGE(?:_(\d+))?__$/);
      if (m) {
        const idx = m[1] ? Math.max(0, Number(m[1]) - 1) : nextImgIdx++;
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

  // Only mutate node inputs (keep structure stable)
  for (const node of Object.values(graph) as any[]) {
    if (!node?.inputs || typeof node.inputs !== "object") continue;
    for (const [k, v] of Object.entries(node.inputs)) {
      (node.inputs as any)[k] = replaceInValue(v);
    }
  }
}






async function parseOtgBody(req: NextRequest) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  // Primary path: JSON (preferred)
  if (!ct.includes("multipart/form-data")) {
    return await req.json().catch(() => null);
  }

  // Fallback: multipart/form-data (mobile clients often use FormData)
  const fd = await req.formData().catch(() => null);
  if (!fd) return null;

  const preset = String(fd.get("workflowId") || fd.get("preset") || "").trim();
  const positivePrompt = String(fd.get("prompt") || fd.get("positivePrompt") || "");
  const negativePrompt = String(fd.get("negativePrompt") || "");
  const orientation = String(fd.get("orientation") || "");
  const durationSeconds = String(fd.get("durationSeconds") || "");

  const fileKeys = ["imageA", "imageB", "imageC", "imageD"];
  const inputImages: string[] = [];

  for (const key of fileKeys) {
    const v: any = fd.get(key);
    if (!v || typeof v === "string") continue;
    // Upload to ComfyUI input via /upload/image so the workflow can load it.
    try {
      const up = new FormData();
      const filename = (v as any)?.name ? String((v as any).name) : `otg_${Date.now()}_${key}.png`;
      up.append("image", v, filename);
      const r = await fetch(`${COMFY_BASE_URL}/upload/image`, { method: "POST", body: up });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || !j.name) {
        throw new Error(j?.error || `upload failed (${r.status})`);
      }
      const name = j.subfolder ? `${String(j.subfolder).replace(/^\/+|\/+$/g, "")}/${j.name}` : j.name;
      inputImages.push(String(name));
    } catch (e: any) {
      throw new Error(`Image upload failed for ${key}: ${String(e?.message || e)}`);
    }
  }

  return {
    preset,
    positivePrompt,
    negativePrompt,
    orientation,
    durationSeconds,
    inputImages,
  };
}

export async function GET(req: NextRequest) {
  const deviceId = safeDeviceId(req.headers.get("x-otg-device-id"));

  try {
    const r = await fetch(`${COMFY_BASE_URL}/system_stats`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    return Response.json(
      {
        serverState: r.ok ? "idle" : "down",
        serverHint: r.ok ? "Connected" : "Disconnected",
        comfyBaseUrl: COMFY_BASE_URL,
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

  // Enforce single-active *generation* rule.
  // We only block when a job is currently running. If the previous job
  // completed (status "ready"), we allow a new generation without requiring
  // the user to press Clear first.
  const st = readState(ownerKey);
  if (st.status === "running") {
    return Response.json(
      { ok: false, error: "A generation is already running. Please wait for it to finish.", status: st.status },
      { status: 409 }
    );
  }

  const body = await parseOtgBody(req).catch(() => null);
  if (!body) return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });

// 1) Load workflow by ID using the SAME resolver as /api/workflows (respects OTG_WORKFLOWS_ROOT and index.json)
  let graph: any = null;
  // Optional OTG metadata embedded in workflow JSON (used to target the correct text-encode nodes)
  let otgMeta: any = undefined;

  if (body.prompt && typeof body.prompt === "object") {
    graph = body.prompt;
  } else if (body.preset) {
    const wf = loadWorkflowById(String(body.preset));
    if (!wf.ok) {
      return Response.json({ ok: false, error: `Preset not found: ${String(body.preset)}`, detail: wf.error }, { status: wf.status });
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
  } else if (typeof body === "object") {
    // last resort: treat as prompt graph
    graph = body;
  }

  if (!graph || typeof graph !== "object") {
    return Response.json({ ok: false, error: "Could not build pr...mpt graph (missing preset or prompt graph)" }, { status: 400 });
  }

  // 2) Apply prompts/seeds/images from OTG payload
  const positive = String(body.positivePrompt ?? (Array.isArray(body.prompts) ? body.prompts[0] : "") ?? "");
  const negative = String(body.negativePrompt ?? "");
  const inputImages: string[] = Array.isArray((body as any).inputImages) ? (body as any).inputImages.map(String) : [];

  // First, replace OTG placeholders embedded in workflow graphs (most reliable).
  applyOtgPlaceholders(graph, { positive, negative, inputImages });

  // Then, as a fallback, try to locate text encoders and set their prompt strings.
  if (positive || negative) setTextEncodes(graph, positive, negative, otgMeta);

  // Seed: default to random each run unless explicitly provided.
const _seedProvided = Number.isFinite(Number((body as any).seed));
const _seedValue = _seedProvided
  ? Math.floor(Number((body as any).seed))
  : Math.floor(Math.random() * 0xffffffff);
setSeed(graph, _seedValue);
  // Optional overrides driven by OTG UI controls
  // Enforce 720p (1280x720 landscape, 720x1280 portrait) for ALL workflows for consistency.
  const orient = String((body as any).orientation || "").toLowerCase();
  if (orient === "portrait") {
    setSize(graph, 720, 1280);
  } else if (orient === "landscape") {
    setSize(graph, 1280, 720);
  } else if (Number.isFinite(Number((body as any).width)) && Number.isFinite(Number((body as any).height))) {
    setSize(graph, Math.floor(Number((body as any).width)), Math.floor(Number((body as any).height)));
  }
  if (Number.isFinite(Number((body as any).durationSeconds))) {
    setDurationSeconds(graph, Math.floor(Number((body as any).durationSeconds)));
  }


  // 3) Enforce owner-scoped tagging via filename_prefix (reliable even with shared output folder)
  const title = String((body as any)?.title || (body as any)?.name || "").trim();
  const prefix = `${title || "otg"}__${ownerKey}`;
  setFilenamePrefix(graph, prefix);

  // 3) Mark running (server-side lock)
  try {
    markRunning(ownerKey, { title: title || null, workflowId: String(body.preset || "") || null });
  } catch {
    // ignore
  }

  // 3) Submit to ComfyUI with client_id=deviceId
  const upstream = await fetch(`${COMFY_BASE_URL}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // IMPORTANT: use deviceId so /api/comfy-events?clientId=<deviceId> matches this run.
    body: JSON.stringify({ prompt: sanitizeComfyPromptGraph(graph), client_id: deviceId  }),
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

  // 4) Persist job submission (existing behavior)
  try {
    ensureDir(JOBS_DIR);
    const jobPath = path.join(JOBS_DIR, `${deviceId}.jsonl`);

    const prompt_id = String((parsed as any)?.prompt_id || "").trim() || null;

    fs.appendFileSync(
      jobPath,
      // NOTE: must be true JSONL (one object per line). Older builds accidentally
      // appended pretty JSON blocks; server readers are tolerant, but we now write
      // correct JSONL going forward.
      JSON.stringify({
        ts: Date.now(),
        ownerKey,
        username: ownerCtx.username ?? null,
        deviceId,
        title: title || null,
        preset: body.preset ?? null,
        prompts: Array.isArray(body.prompts) ? body.prompts : null,
        positivePrompt: body.positivePrompt ?? null,
        negativePrompt: body.negativePrompt ?? null,
        seed: Number.isFinite(Number(body.seed)) ? Math.floor(Number(body.seed)) : null,
        useImg2Img: Boolean((body as any)?.useImg2Img),
        imagePath: String((body as any)?.imagePath || "") || null,
        loras: Array.isArray((body as any)?.loras) ? (body as any).loras : null,
        prompt_id,
        rawResponse: parsed,
        // Keep a minimal retry payload. The client can POST this back to /api/comfy.
        submitPayload: {
          preset: body.preset ?? null,
          prompts: Array.isArray(body.prompts) ? body.prompts : null,
          positivePrompt: body.positivePrompt ?? null,
          negativePrompt: body.negativePrompt ?? null,
          seed: Number.isFinite(Number(body.seed)) ? Math.floor(Number(body.seed)) : null,
          seedMode: (body as any)?.seedMode ?? null,
          loras: Array.isArray((body as any)?.loras) ? (body as any).loras : null,
          imagePath: String((body as any)?.imagePath || "") || "",
          useImg2Img: Boolean((body as any)?.useImg2Img),
          forceImg2Img: Boolean((body as any)?.forceImg2Img),
          title: title || "",
          width: Number.isFinite(Number((body as any).width)) ? Math.floor(Number((body as any).width)) : null,
          height: Number.isFinite(Number((body as any).height)) ? Math.floor(Number((body as any).height)) : null,
          durationSeconds: Number.isFinite(Number((body as any).durationSeconds)) ? Math.floor(Number((body as any).durationSeconds)) : null,
          orientation: (body as any).orientation ?? null,
          enhanceLevel: (body as any).enhanceLevel ?? null,
        },
      }) + "\n",
      "utf-8"
    );
  } catch {
    // don't fail job submission if persistence fails
  }

  // 5) NEW: Index generated outputs for this device (gallery isolation)
    // Gallery indexing/copying is handled by /api/gallery/sync (per-owner folder + filename tag filter).

  return Response.json(parsed, { status: 200 });
}