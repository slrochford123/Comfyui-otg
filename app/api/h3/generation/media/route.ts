import path from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getH3DirectJob } from "@/lib/h3DirectJobs";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { OTG_DATA_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const job = jobId ? await getH3DirectJob(ownerKey, jobId) : null;
    if (!job?.outputPath || job.status !== "completed") return NextResponse.json({ ok: false, error: "Generated H3 video not found." }, { status: 404 });
    const resolved = path.resolve(job.outputPath);
    const allowedRoot = path.resolve(OTG_DATA_ROOT);
    if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) return NextResponse.json({ ok: false, error: "Generated H3 video path is outside the data root." }, { status: 403 });
    return mediaFileResponse(req, resolved, { contentType: "video/mp4", fileName: path.basename(resolved), cacheControl: "private, no-store" });
  } catch (error) {
    if (error instanceof SessionInvalidError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not read generated H3 video." }, { status: 500 });
  }
}
