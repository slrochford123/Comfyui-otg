import path from "node:path";
import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";

import { mediaFileResponse, contentTypeForMedia } from "@/lib/mediaResponse";
import { requireSessionUser } from "@/lib/sessionUser";
import { getStoryVisualVersion } from "@/lib/storyCreator/store";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim();
    const versionId = String(request.nextUrl.searchParams.get("versionId") || "").trim();
    const version = getStoryVisualVersion({ ownerKey: user.ownerKey, projectId, versionId });
    if (!version.filePath) {
      return NextResponse.json({ ok: false, error: "Visual file is not available." }, { status: 404 });
    }
    const resolved = path.resolve(version.filePath);
    const permittedRoots = [
      safeJoin(OTG_DATA_ROOT, "story-creator", "media", safeSegment(user.ownerKey), safeSegment(projectId)),
      safeJoin(OTG_DATA_ROOT, "story-creator", "visual-assets", safeSegment(user.ownerKey), safeSegment(projectId)),
    ].map((root) => path.resolve(root));
    const permitted = permittedRoots.some((root) => {
      const relative = path.relative(root, resolved);
      return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
    if (!permitted || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return NextResponse.json({ ok: false, error: "Visual file is missing from protected storage." }, { status: 404 });
    }
    return mediaFileResponse(request, resolved, {
      fileName: path.basename(version.filePath),
      contentType: contentTypeForMedia(resolved),
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
    const status = error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
      ? 404
      : code.endsWith("NOT_FOUND")
        ? 404
        : 401;
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Visual file request failed.",
    }, { status });
  }
}
