import { NextRequest, NextResponse } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { readThreeDJob, hasActiveThreeDJob } from "@/lib/threeDJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  let owner;
  try {
    owner = await getOwnerContext(req);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }

  const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "Missing jobId" }, { status: 400 });
  }

  const job = await readThreeDJob(owner.ownerKey, jobId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "3D job not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      ok: true,
      jobId: job.jobId,
      status: job.status,
      message: job.message,
      progressStage: job.progressStage,
      inputImageUrl: job.inputImageUrl,
      processedImageUrl: job.processedImageUrl,
      preprocessChanged: job.preprocessChanged,
      preprocessConfidence: job.preprocessConfidence,
      resultUrl: job.resultUrl,
      previewSupported: job.previewSupported,
      promptId: job.promptId,
      endpoint: job.endpoint,
      preprocessNote: job.preprocessNote,
      error: job.error,
      activeInMemory: hasActiveThreeDJob(job.jobId),
      updatedAt: job.updatedAt,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
