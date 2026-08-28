import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeStoryboardReferenceFilePartV36BB(value: unknown) {
  return String(value || "reference")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "reference";
}

function extensionFromMimeOrNameV36BB(mime: string, name: string) {
  const lowerName = String(name || "").toLowerCase();
  const lowerMime = String(mime || "").toLowerCase();

  if (lowerName.endsWith(".png") || lowerMime.includes("png")) return ".png";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") || lowerMime.includes("jpeg") || lowerMime.includes("jpg")) return ".jpg";
  if (lowerName.endsWith(".webp") || lowerMime.includes("webp")) return ".webp";

  return ".png";
}

export async function POST(req: NextRequest) {
  // OTG_STORYBOARD_IMPORT_BROWSER_BLOB_REFERENCES_V36BB
  // Imports browser-only reference images into stable OTG storage before workflow submission.
  try {
    const form = await req.formData();
    const image = form.get("image") as any;

    if (!image || typeof image.arrayBuffer !== "function") {
      return NextResponse.json({ ok: false, error: "Missing image file." }, { status: 400 });
    }

    const originalName = String(image.name || form.get("filename") || "storyboard-reference.png");
    const mime = String(image.type || "image/png");

    if (mime && !mime.toLowerCase().startsWith("image/")) {
      return NextResponse.json({ ok: false, error: `Unsupported reference type: ${mime}` }, { status: 400 });
    }

    const arrayBuffer = await image.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    if (!bytes.length) {
      return NextResponse.json({ ok: false, error: "Uploaded reference image was empty." }, { status: 400 });
    }

    const maxBytes = 100 * 1024 * 1024;
    if (bytes.length > maxBytes) {
      return NextResponse.json({ ok: false, error: "Uploaded reference image is too large." }, { status: 413 });
    }

    const promptKey = sanitizeStoryboardReferenceFilePartV36BB(form.get("promptKey"));
    const label = sanitizeStoryboardReferenceFilePartV36BB(form.get("label") || originalName);
    const ext = extensionFromMimeOrNameV36BB(mime, originalName);

    const outputDir = path.join(process.cwd(), "data", "storyboard_reference_uploads");
    await fs.mkdir(outputDir, { recursive: true });

    const fileName = `${promptKey}-${label}-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
    const serverPath = path.join(outputDir, fileName);

    await fs.writeFile(serverPath, bytes);

    return NextResponse.json({
      ok: true,
      fileName,
      serverPath,
      imagePath: serverPath,
      workflowImage: serverPath,
      imageUrl: `/api/file?path=${encodeURIComponent(serverPath)}`,
      bytes: bytes.length,
      mime,
      marker: "OTG_STORYBOARD_IMPORT_BROWSER_BLOB_REFERENCES_V36BB",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(error?.message || error || "Failed to import storyboard reference image."),
        marker: "OTG_STORYBOARD_IMPORT_BROWSER_BLOB_REFERENCES_V36BB",
      },
      { status: 500 },
    );
  }
}