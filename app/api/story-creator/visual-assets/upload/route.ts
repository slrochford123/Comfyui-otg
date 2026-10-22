import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { attachStoryVisualUpload } from "@/lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;
const MIME_EXT = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

export async function POST(request: NextRequest) {
  let writtenPath = "";
  try {
    const user = await requireSessionUser(request);
    const form = await request.formData();
    const file = form.get("image");
    const projectId = String(form.get("projectId") || "").trim();
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ ok: false, error: "Choose a non-empty PNG, JPEG, or WEBP image." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "Image exceeds the 25 MB upload limit." }, { status: 413 });
    }
    const ext = MIME_EXT.get(String(file.type || "").toLowerCase());
    if (!ext) {
      return NextResponse.json({ ok: false, error: "Unsupported image type. Use PNG, JPEG, or WEBP." }, { status: 400 });
    }

    const dir = path.join(
      OTG_DATA_ROOT,
      "story-creator",
      "visual-assets",
      safeSegment(user.ownerKey),
      safeSegment(projectId),
    );
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    writtenPath = path.join(dir, `${crypto.randomUUID()}${ext}`);
    await fs.writeFile(writtenPath, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });

    const attached = attachStoryVisualUpload({
      ownerKey: user.ownerKey,
      projectId,
      assetId: form.get("assetId"),
      visualKind: form.get("visualKind"),
      name: form.get("name"),
      prompt: form.get("prompt"),
      filePath: writtenPath,
      url: "",
      metadata: { originalName: file.name, mime: file.type, bytes: file.size },
    });
    const url = `/api/story-creator/visual-assets/media?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(attached.version.id)}`;
    return NextResponse.json({ ok: true, ...attached, url }, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (writtenPath) await fs.rm(writtenPath, { force: true }).catch(() => undefined);
    const status = error instanceof SessionInvalidError ? 401 : 400;
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Visual upload failed.",
    }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
