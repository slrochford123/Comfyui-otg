import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v"]);

function safeFileName(value: string) {
  const base = path.basename(String(value || "clip.mp4").trim() || "clip.mp4");
  return base.replace(/[\r\n\\/:*?"<>|]+/g, "_").replace(/^_+|_+$/g, "") || "clip.mp4";
}

function fileUrlFor(absPath: string) {
  return `/api/file?path=${encodeURIComponent(absPath)}`;
}

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();

  try {
    const owner = await getOwnerContext(req);
    const form = await req.formData();
    const file = form.get("clip");
    const sceneId = safeSegment(String(form.get("sceneId") || "scene").trim() || "scene");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing video clip file." }, { status: 400 });
    }

    const originalName = safeFileName(file.name);
    const ext = path.extname(originalName).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) {
      return NextResponse.json({ ok: false, error: "Upload an mp4, webm, mov, or m4v video clip." }, { status: 400 });
    }

    const outputDir = path.join(OTG_DATA_ROOT, "productions", safeSegment(owner.ownerKey || "local"), sceneId, "edit_uploads");
    await ensureDir(outputDir);

    const fileName = `${Date.now()}_${originalName}`;
    const outputPath = path.join(outputDir, fileName);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await fs.writeFile(outputPath, bytes);

    return NextResponse.json({
      ok: true,
      fileName,
      originalName,
      videoPath: outputPath,
      videoUrl: fileUrlFor(outputPath),
      size: bytes.byteLength,
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Clip upload failed." }, { status: 500 });
  }
}
