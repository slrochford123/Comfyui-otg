import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";

import { resolveComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { loadWorkflowById, extractPromptGraph, validatePromptGraph } from "@/lib/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type HistoryFile = { filename: string; subfolder?: string; type?: string };

function safeDeviceId(raw: string | null) {
  const v = (raw || "").toString().trim();
  const cleaned = v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return cleaned || "local";
}

function ensureDirSync(p: string) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}

function randSeed() {
  // Comfy nodes typically accept up to 64-bit ints; stay within JS safe int.
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
      } else if (v && typeof v === "object") {
        // Some nodes nest under { files: [...] } or similar
        if (Array.isArray((v as any).files)) {
          for (const item of (v as any).files) pushIfFile(item);
        }
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

export async function POST(req: NextRequest) {
  // Auth gate (same as the rest of /app)
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

    const { baseUrl, targetId } = await resolveComfyBaseUrl();
    const COMFY_BASE_URL = baseUrl.replace(/\/+$/, "");
    const comfyClientId = targetId ? `${deviceId}-${targetId}-angles3d` : `${deviceId}-angles3d`;

    const fd = await req.formData();
    const file = fd.get("image");
    if (!file || typeof file === "string") {
      return NextResponse.json({ ok: false, error: "Missing image file" }, { status: 400 });
    }

    // 1) Upload image to ComfyUI input
    const up = new FormData();
    const filename = (file as any)?.name ? String((file as any).name) : `otg_angles_${Date.now()}.png`;
    up.append("image", file as any, filename);

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

    // 2) Load the internal Hunyuan3D workflow (prompt graph)
    // File is shipped under comfy_workflows/internal/angles_3d_preview.json
    const wf = loadWorkflowById("internal/angles_3d_preview");
    if (!wf.ok) {
      return NextResponse.json(
        { ok: false, error: `3D workflow not found: internal/angles_3d_preview`, detail: wf.error },
        { status: wf.status }
      );
    }

    const extracted = extractPromptGraph(wf.json);
    if (!extracted.ok) {
      return NextResponse.json({ ok: false, error: extracted.error }, { status: 400 });
    }

    const validated = validatePromptGraph(extracted.graph);
    if (!validated.ok) {
      return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
    }

    // Clone the graph so we can safely mutate
    const graph: any = JSON.parse(JSON.stringify(extracted.graph));

    // 3) Inject the uploaded image + random seed + unique output prefix
    // Node 2: LoadImage
    if (graph?.["2"]?.class_type === "LoadImage" && graph["2"]?.inputs) {
      graph["2"].inputs.image = uploadedName;
    }

    // Node 7: KSampler seed
    if (graph?.["7"]?.class_type === "KSampler" && graph["7"]?.inputs) {
      graph["7"].inputs.seed = randSeed();
    }

    // Node 10: SaveGLB filename_prefix
    if (graph?.["10"]?.class_type === "SaveGLB" && graph["10"]?.inputs) {
      graph["10"].inputs.filename_prefix = `otg_tmp_angles/${deviceId}/preview_${Date.now()}`;
    }

    // 4) Submit to Comfy
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

    // 5) Poll history for the GLB output
    const maxMs = 180_000;
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
      await sleep(800);
    }

    if (!glbFile) {
      return NextResponse.json({ ok: false, error: "Timed out waiting for GLB output", promptId }, { status: 504 });
    }

    // 6) Fetch bytes from Comfy /view
    const bytes = await fetchComfyViewBytes(COMFY_BASE_URL, glbFile);

    // 7) Save into OTG temp (NOT gallery) and return a local preview URL
    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const outDir = path.join(dataRoot, "tmp", "angles_preview", deviceId);
    ensureDirSync(outDir);

    // Clean old previews (best-effort)
    try {
      const ents = await fs.readdir(outDir).catch(() => [] as string[]);
      for (const name of ents) {
        if (/\.glb$/i.test(name)) {
          await fs.unlink(path.join(outDir, name)).catch(() => void 0);
        }
      }
    } catch {
      // ignore
    }

    const outPath = path.join(outDir, `${promptId}.glb`);
    await fs.writeFile(outPath, bytes);

    const modelUrl = `/api/file?path=${encodeURIComponent(outPath)}`;

    return NextResponse.json(
      {
        ok: true,
        promptId,
        modelUrl,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
