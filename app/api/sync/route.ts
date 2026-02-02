import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const COMFY_BASE_URL = process.env.COMFY_BASE_URL || "http://127.0.0.1:8188";
const DEVICE_ROOT =
  process.env.OTG_DATA_DIR
    ? path.join(process.env.OTG_DATA_DIR, "device_galleries")
    : "C:/Users/SLRoc/comfy-controller/data/device_galleries";

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function isImg(name: string) {
  return /\.(png|jpg|jpeg|webp)$/i.test(name);
}

// pull images out of comfy history record
function extractImages(rec: any): Array<{ filename: string; subfolder?: string; type?: string }> {
  const out: Array<{ filename: string; subfolder?: string; type?: string }> = [];
  const outputs = rec?.outputs;
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

async function fetchViewBytes(f: { filename: string; subfolder?: string; type?: string }) {
  const filename = encodeURIComponent(f.filename);
  const type = encodeURIComponent(f.type || "output");
  const subfolder = encodeURIComponent(f.subfolder || "");
  const url = `${COMFY_BASE_URL}/view?filename=${filename}&type=${type}&subfolder=${subfolder}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Comfy /view ${r.status} for ${f.filename}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const deviceId =
      body.deviceId ||
      req.headers.get("x-otg-device-id") ||
      new URL(req.url).searchParams.get("deviceId") ||
      "local";

    const limit = Number(body.limit || 10);

    // 1) get full history (ComfyUI returns a map)
    const histRes = await fetch(`${COMFY_BASE_URL}/history`, { cache: "no-store" });
    if (!histRes.ok) {
      return Response.json({ error: `Failed to read /history (${histRes.status})` }, { status: 502 });
    }
    const hist = await histRes.json();

    // 2) take newest prompt ids
    const promptIds = Object.keys(hist).slice(0, limit);

    const deviceDir = path.join(DEVICE_ROOT, deviceId);
    ensureDir(deviceDir);

    const saved: string[] = [];
    const inspected: string[] = [];

    for (const pid of promptIds) {
      const rec = hist[pid];
      inspected.push(pid);

      const imgs = extractImages(rec);
      for (const img of imgs) {
        if (!isImg(img.filename)) continue;

        const base = path.basename(img.filename);
        const outName = `${pid}__${base}`;
        const dst = path.join(deviceDir, outName);

        if (fs.existsSync(dst)) continue; // don’t duplicate

        const bytes = await fetchViewBytes(img);
        fs.writeFileSync(dst, bytes);
        saved.push(outName);
      }
    }

    return Response.json({
      ok: true,
      deviceId,
      deviceDir,
      inspectedCount: inspected.length,
      savedCount: saved.length,
      saved,
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
