import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getGallerySourcesForRequest } from "@/lib/gallery";
import { getH3DirectJob, saveH3DirectJobToGallery } from "@/lib/h3DirectJobs";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { jobId?: unknown } | null;
    const { owner, sources } = await getGallerySourcesForRequest(req);
    const jobId = String(body?.jobId || "").trim();
    const job = jobId ? await getH3DirectJob(owner.ownerKey, jobId) : null;
    if (!job?.outputPath || job.status !== "completed") return NextResponse.json({ ok: false, error: "Completed H3 video not found." }, { status: 404 });
    const targetSource = sources.find((source) => source.scope === "user") || sources[0];
    if (!targetSource) return NextResponse.json({ ok: false, error: "Gallery source not found." }, { status: 500 });
    const saved = await saveH3DirectJobToGallery(job, targetSource);
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    if (error instanceof SessionInvalidError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not add H3 video to Gallery." }, { status: 500 });
  }
}
