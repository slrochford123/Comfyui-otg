import { NextRequest, NextResponse } from "next/server";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import {
  applyMovieDirectorInstruction,
  approveMovieTimelineVersion,
  assembleMovieTimeline,
  claimMovieRender,
  getMovieRenderJob,
  getMovieTimeline,
  movieEditorSnapshot,
  prepareMovieRender,
  restoreMovieTimelineVersion,
  saveMovieTimelineVersion,
  updateMovieRender,
} from "@/lib/storyCreator/movieEditor";
import { dispatchMovieRender } from "@/lib/storyCreator/movieRenderExecutor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}

function failure(error: unknown) {
  const status = error instanceof SessionInvalidError ? 401 : typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) || 400 : 400;
  return response({ ok: false, error: status === 401 ? "Unauthorized" : error instanceof Error ? error.message : "Movie Editor request failed." }, status);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim();
    const timelineId = String(request.nextUrl.searchParams.get("timelineId") || "").trim();
    return response({ ok: true, ...movieEditorSnapshot({ ownerKey: user.ownerKey, projectId }), timeline: timelineId ? getMovieTimeline({ ownerKey: user.ownerKey, projectId, timelineId }) : null });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "").trim();
    const common = { ownerKey: user.ownerKey, projectId: body.projectId };
    if (action === "assemble") return response({ ok: true, timeline: assembleMovieTimeline({ ...common, name: body.name, sceneIds: body.sceneIds, shotIds: body.shotIds, idempotencyKey: body.idempotencyKey }) }, 201);
    if (action === "director-edit") return response({ ok: true, ...applyMovieDirectorInstruction({ ...common, timelineId: body.timelineId, instruction: body.instruction }) }, 201);
    if (action === "save-version") return response({ ok: true, timeline: saveMovieTimelineVersion({ ...common, timelineId: body.timelineId, snapshot: body.snapshot, label: body.label }) }, 201);
    if (action === "restore-version") return response({ ok: true, timeline: restoreMovieTimelineVersion({ ...common, timelineId: body.timelineId, versionId: body.versionId }) }, 201);
    if (action === "approve-version") return response({ ok: true, timeline: approveMovieTimelineVersion({ ...common, timelineId: body.timelineId, versionId: body.versionId }) });
    if (action === "prepare-export") return response({ ok: true, render: prepareMovieRender({ ...common, timelineId: body.timelineId, versionId: body.versionId, preset: body.preset, idempotencyKey: body.idempotencyKey, allowIncomplete: body.allowIncomplete }) }, 201);
    if (action === "render-movie") {
      if (body.authorized !== true) return response({ ok: false, error: "Explicit render authorization is required." }, 400);
      const claimed = claimMovieRender({ ownerKey: user.ownerKey, projectId: String(body.projectId || ""), renderId: String(body.renderId || "") });
      dispatchMovieRender({ ownerKey: user.ownerKey, projectId: claimed.projectId, renderId: claimed.id });
      return response({ ok: true, render: claimed, executionStatus: "authorized-and-queued" }, 202);
    }
    if (action === "retry-render") {
      if (body.authorized !== true) return response({ ok: false, error: "Explicit retry authorization is required." }, 400);
      const job = getMovieRenderJob({ ...common, renderId: body.renderId });
      const claimed = claimMovieRender({ ownerKey: user.ownerKey, projectId: job.projectId, renderId: job.id });
      dispatchMovieRender({ ownerKey: user.ownerKey, projectId: job.projectId, renderId: job.id });
      return response({ ok: true, render: claimed }, 202);
    }
    if (action === "cancel-render") {
      const job = getMovieRenderJob({ ...common, renderId: body.renderId });
      if (!['prepared', 'queued'].includes(job.status)) return response({ ok: false, error: "Only a prepared or queued render can be canceled safely." }, 409);
      return response({ ok: true, render: updateMovieRender({ ownerKey: user.ownerKey, projectId: job.projectId, renderId: job.id, status: "canceled", progress: job.progress, stage: "canceled" }) });
    }
    return response({ ok: false, error: "Movie Editor action is not supported." }, 400);
  } catch (error) { return failure(error); }
}
