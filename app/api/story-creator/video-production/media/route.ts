import fs from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { mediaFileResponse } from "@/lib/mediaResponse";
import { SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import { requireSessionUser } from "@/lib/sessionUser";
import { getStoryVideoTake } from "@/lib/storyCreator/videoProduction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serve(request: NextRequest, method: "GET" | "HEAD") {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim();
    const takeId = String(request.nextUrl.searchParams.get("takeId") || "").trim();
    const take = getStoryVideoTake({ ownerKey: user.ownerKey, projectId, takeId });
    if (!take.outputPath || !["completed", "accepted", "rejected"].includes(take.status)) {
      return NextResponse.json({ ok: false, error: "Completed Story video was not found." }, { status: 404 });
    }
    const ownerRoot = safeJoin(OTG_DATA_ROOT, "productions-v2", safeSegment(user.ownerKey));
    const resolved = path.resolve(take.outputPath);
    const relative = path.relative(ownerRoot, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved)) {
      return NextResponse.json({ ok: false, error: "Story video path is invalid." }, { status: 404 });
    }
    return mediaFileResponse(request, resolved, {
      method,
      cacheControl: "private, no-transform, max-age=3600",
    });
  } catch (error) {
    const status = error instanceof SessionInvalidError
      ? 401
      : typeof error === "object" && error && "status" in error
      ? Number((error as { status?: unknown }).status) || 400
      : 400;
    return NextResponse.json({
      ok: false,
      error: status === 401 ? "Unauthorized" : error instanceof Error ? error.message : "Could not serve Story video.",
    }, { status });
  }
}

export function GET(request: NextRequest) {
  return serve(request, "GET");
}

export function HEAD(request: NextRequest) {
  return serve(request, "HEAD");
}
