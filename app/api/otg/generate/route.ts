import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";


import { optionalUserId } from "@/lib/authServer";
import { userInboxDir, deviceInboxDir } from "@/lib/paths";
export const runtime = "nodejs";

// Comfy base URL
const COMFY_BASE_URL = process.env.COMFY_BASE_URL || "http://127.0.0.1:8188";

type ComfyPromptResponse = { prompt_id?: string; error?: string };

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractImagesFromHistory(record: any): Array<{ filename: string; subfolder?: string; type?: string }> {
  const out: Array<{ filename: string; subfolder?: string; type?: string }> = [];
  const outputs = record?.outputs;
  if (!outputs || typeof outputs !== "object") return out;

  for (const k of Object.keys(outputs)) {
    const node = outputs[k];
    if (Array.isArray(node?.images)) {
      for (const img of node.images) {
        if (img?.filename) {
          out.push({
            filename: String(img.filename),
            subfolder: img.subfolder ? String(img.subfolder) : "",
            type: img.type ? String(img.type) : "output",
          });
        }
      }
    }
  }
  return out;
}

async function fetchComfyViewBytes(f: { filename: string; subfolder?: string; type?: string }) {
  const filename = encodeURIComponent(f.filename);
  const type = encodeURIComponent(f.type || "output");
  const subfolder = encodeURIComponent(f.subfolder || "");
  const url = `${COMFY_BASE_URL}/view?filename=${filename}&type=${type}&subfolder=${subfolder}`;

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Comfy /view failed ${r.status} for ${f.filename}: ${txt.slice(0, 120)}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const deviceId =
      body.deviceId ||
      req.headers.get("x-otg-device-id") ||
      "local";

    const promptPayload = body.prompt;
    if (!promptPayload || typeof promptPayload !== "object") {
      return Response.json({ error: "Missing prompt object" }, { status: 400 });
    }

    // 1) Submit to ComfyUI
    const submit = await fetch(`${COMFY_BASE_URL}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(promptPayload),
    });

    const submitJson = (await submit.json().catch(() => ({}))) as ComfyPromptResponse;
    if (!submit.ok || !submitJson.prompt_id) {
      return Response.json(
        { error: submitJson.error || `Comfy submit failed (${submit.status})`, submitJson },
        { status: 502 }
      );
    }

    const promptId = submitJson.prompt_id;

    // 2) Poll history for outputs
    const maxMs = 120_000;
    const start = Date.now();
    let record: any = null;
    let imgs: Array<{ filename: string; subfolder?: string; type?: string }> = [];

    while (Date.now() - start < maxMs) {
      const h = await fetch(`${COMFY_BASE_URL}/history/${promptId}`, { cache: "no-store" });
      if (h.ok) {
        const hjson = await h.json().catch(() => ({}));
        record = hjson?.[promptId] || hjson;
        imgs = extractImagesFromHistory(record);
        if (imgs.length > 0) break;
      }
      await sleep(700);
    }

    if (imgs.length === 0) {
      return Response.json({ error: "Timed out waiting for outputs", promptId }, { status: 504 });
    }

    // 3) Save into device gallery folder (C:)
    const userId = await optionalUserId(req);

    // If logged in, save into per-user gallery (cross-device).
    // Otherwise, save into per-device gallery.
    const deviceDir = userId ? userInboxDir(String(userId)) : userInboxDir(String(deviceId));
ensureDir(deviceDir);

    const saved: string[] = [];

    for (const img of imgs) {
      // keep only images
      if (!/\.(png|jpg|jpeg|webp)$/i.test(img.filename)) continue;

      const bytes = await fetchComfyViewBytes(img);

      // name it uniquely
      const base = path.basename(img.filename);
      const outName = `${promptId}__${base}`;
      fs.writeFileSync(path.join(deviceDir, outName), bytes);
      saved.push(outName);
    }

    return Response.json({
      ok: true,
      deviceId,
      userId: userId || null,
      scope: userId ? "user" : "device",
      promptId,
      deviceDir,
      saved,
      found: imgs.length,
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
