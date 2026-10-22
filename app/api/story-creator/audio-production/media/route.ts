import fs from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { mediaFileResponse } from "@/lib/mediaResponse";
import { SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT } from "@/lib/paths";
import { requireSessionUser } from "@/lib/sessionUser";
import { listStoryAudioAssets } from "@/lib/storyCreator/audioProduction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serve(request: NextRequest, method: "GET" | "HEAD") {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim();
    const assetId = String(request.nextUrl.searchParams.get("assetId") || "").trim();
    const asset = listStoryAudioAssets({ ownerKey: user.ownerKey, projectId }).find((item) => item.id === assetId);
    if (!asset?.outputPath || !["completed", "accepted", "rejected"].includes(asset.status)) {
      return NextResponse.json({ ok: false, error: "Completed Story audio was not found." }, { status: 404 });
    }
    const resolved = path.resolve(asset.outputPath);
    const dataRoot = path.resolve(OTG_DATA_ROOT);
    const relative = path.relative(dataRoot, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved)) {
      return NextResponse.json({ ok: false, error: "Story audio path is invalid." }, { status: 404 });
    }
    return mediaFileResponse(request, resolved, {
      method,
      cacheControl: "private, no-transform, max-age=3600",
    });
  } catch (error) {
    const status = error instanceof SessionInvalidError ? 401 : 400;
    return NextResponse.json({
      ok: false,
      error: status === 401 ? "Unauthorized" : error instanceof Error ? error.message : "Could not serve Story audio.",
    }, { status });
  }
}

export function GET(request: NextRequest) {
  return serve(request, "GET");
}

export function HEAD(request: NextRequest) {
  return serve(request, "HEAD");
}
