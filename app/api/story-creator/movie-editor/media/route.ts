import fs from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { mediaFileResponse } from "@/lib/mediaResponse";
import { SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT } from "@/lib/paths";
import { requireSessionUser } from "@/lib/sessionUser";
import { getMovieRenderJob } from "@/lib/storyCreator/movieEditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serve(request: NextRequest, method: "GET" | "HEAD") {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim();
    const renderId = String(request.nextUrl.searchParams.get("renderId") || "").trim();
    const job = getMovieRenderJob({ ownerKey: user.ownerKey, projectId, renderId });
    if (job.status !== "completed" || !job.outputPath) return NextResponse.json({ ok: false, error: "Completed movie render was not found." }, { status: 404 });
    const resolved = path.resolve(job.outputPath), root = path.resolve(OTG_DATA_ROOT), relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved)) return NextResponse.json({ ok: false, error: "Movie output path is invalid." }, { status: 404 });
    return mediaFileResponse(request, resolved, { method, cacheControl: "private, no-transform, max-age=3600", fileName: `story-movie-${job.id}.mp4` });
  } catch (error) {
    const status = error instanceof SessionInvalidError ? 401 : typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) || 400 : 400;
    return NextResponse.json({ ok: false, error: status === 401 ? "Unauthorized" : error instanceof Error ? error.message : "Could not serve movie." }, { status });
  }
}

export function GET(request: NextRequest) { return serve(request, "GET"); }
export function HEAD(request: NextRequest) { return serve(request, "HEAD"); }
