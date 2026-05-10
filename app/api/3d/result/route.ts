import { NextRequest, NextResponse } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { readThreeDJob } from "@/lib/threeDJobs";

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

  if (job.status !== "succeeded" || !job.resultUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: job.status === "failed" ? job.error || "3D job failed" : "3D job is not finished yet",
        status: job.status,
        jobId: job.jobId,
        message: job.message,
      },
      { status: job.status === "failed" ? 409 : 425, headers: { "cache-control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      jobId: job.jobId,
      status: job.status,
      modelUrl: job.resultUrl,
      modelExt: job.resultExt,
      previewSupported: job.previewSupported,
      promptId: job.promptId,
      endpoint: job.endpoint,
      preprocessNote: job.preprocessNote,
      processedImageUrl: job.processedImageUrl,
      preprocessChanged: job.preprocessChanged,
      preprocessConfidence: job.preprocessConfidence,
      inputImageUrl: job.inputImageUrl,
      detail: job.detail,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
