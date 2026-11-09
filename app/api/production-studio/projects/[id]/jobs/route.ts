import { NextRequest } from "next/server";
import {
  authorize,
  body,
  studio,
  json,
  failure,
} from "@/lib/productionStudio/server";
import { enqueueStudioJob } from "@/lib/productionStudio/jobs";
import { StudioError } from "@/lib/productionStudio/store";
import { getStoryMedia } from "@/lib/storyCreator/mediaStore";
import { cancelStoryMedia } from "@/lib/storyCreator/mediaExecution";
import { requestedMediaGpu } from "@/lib/mediaGpuRoutingServer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type C = { params: Promise<{ id: string }> };
export async function POST(req: NextRequest, c: C) {
  try {
    const u = await authorize(req, true),
      { id } = await c.params,
      b = await body(req);
    return json(
      {
        job: await enqueueStudioJob(
          studio(),
          u.ownerKey,
          id,
          b,
          req.headers.get("cookie") || "",
          {accountId:u.accountId,...(b.kind==="voice"?{voiceGpuChoice:await requestedMediaGpu()}:{})},
        ),
      },
      202,
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: NextRequest, c: C) {
  try {
    const u = await authorize(req, true),
      { id } = await c.params,
      b = await body(req),
      s = studio(),
      j = s.job(u.ownerKey, String(b.jobId));
    if (j.projectId !== id) throw new StudioError("Job not found.", 404);
    if (!["queued", "running", "canceling"].includes(j.status))
      throw new StudioError("This job is already finished.");
    const next = s.updateJob(u.ownerKey, j.id, {
      status: j.status === "queued" && !j.backendId ? "canceled" : "canceling",
      message: "Cancellation requested",
    });
    if (
      j.backendId?.startsWith("voice:") ||
      j.backendId?.startsWith("story:")
    ) {
      try {
        const record = getStoryMedia(
          u.ownerKey,
          String(j.input.storyId),
          j.backendId.slice(6),
        );
        const result = await cancelStoryMedia(record);
        if (result.status === "canceled")
          s.updateJob(u.ownerKey, j.id, {
            status: "canceled",
            message: "Canceled by media worker",
          });
        else if (result.status === "ready")
          s.updateJob(u.ownerKey, j.id, {
            status: "running",
            message: "Completed before cancellation; collecting result",
          });
        else throw new Error("Unconfirmed");
      } catch {
        s.updateJob(u.ownerKey, j.id, {
          status: "attention",
          message:
            "Cancellation is not confirmed by the original media worker. No replacement job was sent; check the worker before retrying.",
        });
      }
    }
    return json({ job: s.job(u.ownerKey, next.id) });
  } catch (e) {
    return failure(e);
  }
}
