import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES_V36BPL2 = 40 * 1024 * 1024;

function safeSegmentV36BPL2(value: unknown, fallback: string) {
  const text = String(value || "").trim();
  const safe = text.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || fallback;
}

function extensionForUploadV36BPL2(file: File) {
  const byName = path.extname(file.name || "").toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(byName)) return byName;

  const type = String(file.type || "").toLowerCase();
  if (type.includes("png")) return ".png";
  if (type.includes("jpeg") || type.includes("jpg")) return ".jpg";
  if (type.includes("webp")) return ".webp";
  if (type.includes("gif")) return ".gif";
  if (type.includes("bmp")) return ".bmp";

  return ".png";
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("image");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing image upload." }, { status: 400 });
    }

    if (!String(file.type || "").startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "Uploaded file must be an image." }, { status: 400 });
    }

    if (file.size <= 0) {
      return NextResponse.json({ ok: false, error: "Uploaded image is empty." }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES_V36BPL2) {
      return NextResponse.json({ ok: false, error: "Uploaded image is larger than 40MB." }, { status: 413 });
    }

    const profile = safeSegmentV36BPL2(form.get("profile"), "test_profile");
    const sceneId = safeSegmentV36BPL2(form.get("sceneId"), "scene");
    const root = process.cwd();
    const uploadDir = path.join(root, "data", "uploads", "production-scene-inputs", profile);
    await fs.mkdir(uploadDir, { recursive: true });

    const ext = extensionForUploadV36BPL2(file);
    const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const nonce = crypto.randomBytes(4).toString("hex");
    const filename = `${sceneId}-input-scene-${stamp}-${nonce}${ext}`;
    const absolutePath = path.join(uploadDir, filename);

    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(absolutePath, bytes);

    return NextResponse.json({
      ok: true,
      filename,
      workflowImage: absolutePath,
      imagePath: absolutePath,
      previewUrl: `/api/otg/local-image?path=${encodeURIComponent(absolutePath)}`,
      sizeBytes: bytes.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to upload scene input image." },
      { status: 500 },
    );
  }
}
