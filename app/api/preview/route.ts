import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { loadWorkflowById, extractPromptGraph, validatePromptGraph } from "@/lib/workflows";
import { removeBackgroundBestEffort } from "@/app/api/angles/_lib/backgroundRemoval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type HistoryFile = { filename: string; subfolder?: string; type?: string };

const DEFAULT_MESH_COMFY_URL = "http://100.109.254.63:8188";
const HUNYUAN_WORKFLOW_ID = "internal/angles_3d_mesh_hunyuan_v21";

function safeDeviceId(raw: string | null) {
  const v = (raw || "").toString().trim();
  const cleaned = v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return cleaned || "local";
}

function ensureDirSync(p: string) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}

function randSeed() {
  return Math.floor(Math.random() * 9_000_000_000_000_000);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractAnyFilesFromHistory(record: any): HistoryFile[] {
  const out: HistoryFile[] = [];
  const outputs = record?.outputs;
  if (!outputs || typeof outputs !== "object") return out;

  const pushIfFile = (x: any) => {
    if (!x || typeof x !== "object") return;
    if (!x.filename) return;
    out.push({
      filename: String(x.filename),
      subfolder: x.subfolder ? String(x.subfolder) : "",
      type: x.type ? String(x.type) : "output",
    });
  };

  for (const nodeId of Object.keys(outputs)) {
    const nodeOut = outputs[nodeId];
    if (!nodeOut || typeof nodeOut !== "object") continue;
    for (const v of Object.values(nodeOut)) {
      if (Array.isArray(v)) {
        for (const item of v) pushIfFile(item);
      } else if (v && typeof v === "object" && Array.isArray((v as any).files)) {
        for (const item of (v as any).files) pushIfFile(item);
      }
    }
  }

  return out;
}

async function fetchComfyViewBytes(baseUrl: string, f: HistoryFile) {
  const filename = encodeURIComponent(f.filename);
  const type = encodeURIComponent(f.type || "output");
  const subfolder = encodeURIComponent(f.subfolder || "");
  const url = `${baseUrl}/view?filename=${filename}&type=${type}&subfolder=${subfolder}`;

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Comfy /view failed ${r.status} for ${f.filename}: ${txt.slice(0, 140)}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

function normalizeBase(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function parseBool(value: FormDataEntryValue | null) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export async function POST(req: NextRequest) {
  try {
    await getOwnerContext(req);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }

  try {
    const deviceId = safeDeviceId(req.headers.get("x-otg-device-id"));
    const COMFY_BASE_URL = normalizeBase(process.env.OTG_ANGLES_MESH_COMFY_URL || DEFAULT_MESH_COMFY_URL);
    const comfyClientId = `${deviceId}-angles3d-mesh`;

    const fd = await req.formData();
    const file = fd.get("image");
    const removeBackground = parseBool(fd.get("removeBackground"));
    if (!file || typeof file === "string") {
      return NextResponse.json({ ok: false, error: "Missing image file" }, { status: 400 });
    }

    let uploadName = (file as any)?.name ? String((file as any).name) : `otg_angles_${Date.now()}.png`;
    let uploadBytes = Buffer.from(await (file as any).arrayBuffer());
    let preprocessNote = "Using original image.";

    if (removeBackground) {
      const cutout = await removeBackgroundBestEffort(uploadBytes);
      uploadBytes = cutout.buffer;
      uploadName = `${path.basename(uploadName, path.extname(uploadName))}_cutout.png`;
      preprocessNote = cutout.note;
    }

    const up = new FormData();
    up.append("image", new Blob([uploadBytes], { type: "image/png" }), uploadName);

    const upRes = await fetch(`${COMFY_BASE_URL}/upload/image`, { method: "POST", body: up });
    const upJson: any = await upRes.json().catch(() => null);
    if (!upRes.ok || !upJson?.name) {
      return NextResponse.json(
        { ok: false, error: upJson?.error || `Comfy upload failed (${upRes.status})`, detail: upJson },
        { status: 502 }
      );
    }

    const uploadedName = upJson.subfolder
      ? `${String(upJson.subfolder).replace(/^\/+|\/+$/g, "")}/${upJson.name}`
      : String(upJson.name);

    const wf = loadWorkflowById(HUNYUAN_WORKFLOW_ID);
    if (!wf.ok) {
      return NextResponse.json(
        { ok: false, error: `3D workflow not found: ${HUNYUAN_WORKFLOW_ID}`, detail: wf.error },
        { status: wf.status }
      );
    }

    const extracted = extractPromptGraph(wf.json);
    if (!extracted.ok) return NextResponse.json({ ok: false, error: extracted.error }, { status: 400 });
    const validated = validatePromptGraph(extracted.graph);
    if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });

    const graph: any = JSON.parse(JSON.stringify(extracted.graph));

    if (graph?.["2"]?.class_type === "LoadImage" && graph["2"]?.inputs) {
      graph["2"].inputs.image = uploadedName;
    }
    if (graph?.["7"]?.class_type === "KSampler" && graph["7"]?.inputs) {
      graph["7"].inputs.seed = randSeed();
    }
    if (graph?.["10"]?.class_type === "SaveGLB" && graph["10"]?.inputs) {
      graph["10"].inputs.filename_prefix = `otg_tmp_angles/${deviceId}/mesh_${Date.now()}`;
    }

    const submit = await fetch(`${COMFY_BASE_URL}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: comfyClientId }),
    });

    const submitText = await submit.text();
    let submitJson: any = null;
    try {
      submitJson = JSON.parse(submitText);
    } catch {
      submitJson = { raw: submitText };
    }

    if (!submit.ok || !submitJson?.prompt_id) {
      return NextResponse.json(
        { ok: false, error: submitJson?.error || `Comfy submit failed (${submit.status})`, detail: submitJson },
        { status: 502 }
      );
    }

    const promptId = String(submitJson.prompt_id);
    const maxMs = 240_000;
    const start = Date.now();
    let glbFile: HistoryFile | null = null;

    while (Date.now() - start < maxMs) {
      const hr = await fetch(`${COMFY_BASE_URL}/history/${encodeURIComponent(promptId)}`, { cache: "no-store" });
      if (hr.ok) {
        const hjson = await hr.json().catch(() => ({}));
        const record = hjson?.[promptId] || hjson;
        const files = extractAnyFilesFromHistory(record);
        glbFile = files.find((f) => /\.glb$/i.test(f.filename)) || null;
        if (glbFile) break;
      }
      await sleep(1000);
    }

    if (!glbFile) {
      return NextResponse.json({ ok: false, error: "Timed out waiting for GLB output", promptId }, { status: 504 });
    }

    const bytes = await fetchComfyViewBytes(COMFY_BASE_URL, glbFile);

    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const outDir = path.join(dataRoot, "tmp", "angles_preview", deviceId);
    ensureDirSync(outDir);

    try {
      const ents = await fs.readdir(outDir).catch(() => [] as string[]);
      for (const name of ents) {
        if (/\.glb$/i.test(name)) await fs.unlink(path.join(outDir, name)).catch(() => void 0);
      }
    } catch {}

    const outPath = path.join(outDir, `${promptId}.glb`);
    await fs.writeFile(outPath, bytes);

    return NextResponse.json(
      {
        ok: true,
        promptId,
        endpoint: COMFY_BASE_URL,
        preprocess: removeBackground ? preprocessNote : "Background removal off.",
        modelUrl: `/api/file?path=${encodeURIComponent(outPath)}`,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
