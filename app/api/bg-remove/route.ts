import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

// Background removal is handled by a local Python microservice (FastAPI + rembg).
// This avoids heavy/fragile Node native deps and keeps Next builds stable.
//
// Configure with:
//   BG_REMOVE_URL=http://127.0.0.1:3333/remove-bg
//
// Note: Next Route Handlers run on the server. We keep runtime=nodejs so we can
// stream binary responses safely.

export const runtime = "nodejs";

function getBgRemoveUrl() {
  return process.env.BG_REMOVE_URL || "http://127.0.0.1:3333/remove-bg";
}

function getTimeoutMs() {
  const raw = process.env.BG_REMOVE_TIMEOUT_MS;
  const n = raw ? Number(raw) : 60000;
  return Number.isFinite(n) && n > 0 ? n : 60000;
}

export async function POST(req: Request) {
  try {
    // Storyboard uses JSON:
    //   POST { imagePath } -> run bg removal -> save -> return { bgRemovedPath }
    // We *only* accept JSON here (client expects JSON). This avoids accidental binary responses
    // that would cause `res.json()` to throw in the UI.

    const raw = await req.text();
    let body: any;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return NextResponse.json({ error: "Request must be JSON: { imagePath }" }, { status: 415 });
    }

    const imagePath = body?.imagePath;
    if (!imagePath || typeof imagePath !== "string") {
      return NextResponse.json({ error: "Missing imagePath" }, { status: 400 });
    }

    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const storyboardRoot = path.resolve(path.join(dataRoot, "uploads", "storyboard"));

    const resolved = path.resolve(imagePath);
    const rel = path.relative(storyboardRoot, resolved);
    // Only allow reads from OTG_DATA_DIR/uploads/storyboard (prevents arbitrary file reads).
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return NextResponse.json({ error: "imagePath is outside storyboard uploads" }, { status: 403 });
    }

    const buf = await fs.readFile(resolved);
    const filename = path.basename(resolved) || "image.png";

    const outForm = new FormData();
    outForm.append("image", new Blob([buf]), filename);

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), getTimeoutMs());

    const url = getBgRemoveUrl();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        body: outForm,
        signal: controller.signal,
      });
    } catch (e: any) {
      const msg = String(e?.message || e || "Failed to reach background removal service");
      return NextResponse.json(
        { error: `Background removal service unavailable. Start the Python service and retry. (${msg})` },
        { status: 503 }
      );
    } finally {
      clearTimeout(t);
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Background removal failed (${res.status}). ${txt || ""}`.trim() },
        { status: 502 }
      );
    }

    const outBuf = Buffer.from(await res.arrayBuffer());

    const outDir = path.join(storyboardRoot, "cleared");
    await fs.mkdir(outDir, { recursive: true });
    const outName = `cleared_${crypto.randomUUID()}.png`;
    const outPath = path.join(outDir, outName);
    await fs.writeFile(outPath, outBuf);

    return NextResponse.json({ bgRemovedPath: outPath });
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}