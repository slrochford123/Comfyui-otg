import { NextRequest } from "next/server";
import { resolveComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { markError, readState, resetState } from "@/lib/contentState";
import { readComfyPromptProgress } from "@/lib/comfyProgress";
import { syncPromptOutputsForOwner } from "@/lib/comfyGallerySync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampPercent(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export async function GET(req: NextRequest) {
  let owner;
  try {
    owner = await getOwnerContext(req);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }

  const state = readState(owner.ownerKey);
  const requestedPromptId = String(req.nextUrl.searchParams.get("promptId") || req.nextUrl.searchParams.get("prompt_id") || "").trim();
  const stateStatus = String(state?.status || "idle").toLowerCase();
  const statePromptId = String(state?.promptId || "").trim();

  if (!requestedPromptId && stateStatus !== "running") {
    const status: "idle" | "complete" | "error" =
      stateStatus === "done" ? "complete" : stateStatus === "error" ? "error" : "idle";
    const progressPercent =
      status === "complete" ? 100 : status === "error" ? clampPercent(state?.progressPercent ?? 100) : 0;

    return Response.json({
      ok: true,
      status,
      running: false,
      queue: 0,
      queue_remaining: 0,
      running_count: 0,
      pending_count: 0,
      prompt_id: statePromptId || null,
      prompt_complete: status === "complete",
      prompt_error: status === "error" ? state?.error || "Generation failed" : null,
      pct: progressPercent,
      percent: progressPercent,
      progressPercent,
      nodeName: null,
      currentNodeId: null,
      currentNodeProgress: null,
      doneNodes: status === "complete" ? Number(state?.totalNodes || 0) : 0,
      cachedNodes: 0,
      totalNodes: state?.totalNodes || 0,
      startedAt: state?.startedAt || null,
      lastUpdateAt: state?.progressUpdatedAt || state?.updatedAt || null,
      completedAt: state?.readyAt || null,
      elapsedMs: null,
      estimatedRemainingMs: null,
      comfyBaseUrl: state?.comfyBaseUrl || null,
      comfyClientId: state?.comfyClientId || null,
      fileName: state?.fileName || null,
      ownerKey: owner.ownerKey,
      scope: owner.scope,
      username: owner.username,
      deviceId: owner.deviceId,
    });
  }

  const { baseUrl } = await resolveComfyBaseUrl();
  const prompt_id =
    requestedPromptId ||
    statePromptId ||
    null;
  const comfyProgress = readComfyPromptProgress(prompt_id);
  const comfyBaseUrl = String(comfyProgress?.comfyBaseUrl || state?.comfyBaseUrl || baseUrl)
    .trim()
    .replace(/\/+$/, "");

  try {
    const queueResp = await fetch(`${comfyBaseUrl}/queue`, { cache: "no-store" });
    const queueJson = await queueResp.json().catch(() => ({}));

    const runningCount =
      Array.isArray((queueJson as any)?.queue_running) ? (queueJson as any).queue_running.length :
      Array.isArray((queueJson as any)?.running) ? (queueJson as any).running.length :
      0;

    const pendingCount =
      Array.isArray((queueJson as any)?.queue_pending) ? (queueJson as any).queue_pending.length :
      Array.isArray((queueJson as any)?.pending) ? (queueJson as any).pending.length :
      0;

    const queue_remaining = runningCount + pendingCount;
    let prompt_error: string | null = null;
    let prompt_complete = false;

    const shouldCheckHistory =
      !!prompt_id &&
      (comfyProgress?.status === "complete" ||
        comfyProgress?.status === "error" ||
        queue_remaining === 0 ||
        state?.status === "done" ||
        requestedPromptId);

    if (prompt_id && shouldCheckHistory) {
      const syncRes = await syncPromptOutputsForOwner({
        promptId: prompt_id,
        ownerKey: owner.ownerKey,
        username: owner.username,
        deviceId: owner.deviceId,
        comfyBaseUrl,
      });

      if (syncRes.status === "error") {
        prompt_error = syncRes.error || "ComfyUI reported an error";
      } else if (syncRes.status === "synced" || syncRes.status === "already-synced") {
        prompt_complete = true;
      }
    }

    if (comfyProgress?.status === "error" && comfyProgress.error) {
      prompt_error = comfyProgress.error;
    }

    if (prompt_error) {
      markError(owner.ownerKey, prompt_error);
    }

    const nextState = readState(owner.ownerKey);

    let status: "idle" | "running" | "complete" | "error" = "idle";
    if (prompt_error || nextState?.status === "error") {
      status = "error";
    } else if (nextState?.status === "done" || prompt_complete || comfyProgress?.status === "complete") {
      status = "complete";
    } else if (
      nextState?.status === "running" ||
      comfyProgress?.status === "running" ||
      comfyProgress?.status === "queued" ||
      queue_remaining > 0 ||
      !!prompt_id
    ) {
      status = "running";
    }

    if (status === "idle" && nextState?.status === "running" && !prompt_id) {
      resetState(owner.ownerKey);
    }

    const progressPercent =
      status === "complete"
        ? 100
        : status === "error"
          ? clampPercent(comfyProgress?.percent ?? nextState?.progressPercent ?? 100)
          : clampPercent(comfyProgress?.percent ?? nextState?.progressPercent ?? 0);

    return Response.json({
      ok: true,
      status,
      running: status === "running",
      queue: queue_remaining,
      queue_remaining,
      running_count: runningCount,
      pending_count: pendingCount,
      prompt_id: prompt_id || null,
      prompt_complete: status === "complete",
      prompt_error,
      pct: progressPercent,
      percent: progressPercent,
      progressPercent,
      nodeName: comfyProgress?.currentNodeId || null,
      currentNodeId: comfyProgress?.currentNodeId || null,
      currentNodeProgress: comfyProgress?.currentNodeProgress || null,
      doneNodes: comfyProgress?.doneNodes || 0,
      cachedNodes: comfyProgress?.cachedNodes || 0,
      totalNodes: comfyProgress?.totalNodes ?? nextState?.totalNodes ?? 0,
      startedAt: comfyProgress?.startedAt ?? nextState?.startedAt ?? null,
      lastUpdateAt: comfyProgress?.lastUpdateAt ?? nextState?.progressUpdatedAt ?? nextState?.updatedAt ?? null,
      completedAt: comfyProgress?.completedAt ?? nextState?.readyAt ?? null,
      elapsedMs: comfyProgress?.elapsedMs ?? null,
      estimatedRemainingMs: comfyProgress?.estimatedRemainingMs ?? null,
      comfyBaseUrl,
      comfyClientId: comfyProgress?.clientId || nextState?.comfyClientId || null,
      fileName: nextState?.fileName || null,
      ownerKey: owner.ownerKey,
      scope: owner.scope,
      username: owner.username,
      deviceId: owner.deviceId,
    });
  } catch (e: any) {
    return Response.json({
      ok: true,
      status: "idle",
      running: false,
      queue: 0,
      queue_remaining: 0,
      pct: 0,
      percent: 0,
      progressPercent: 0,
      prompt_id: state?.promptId || null,
      prompt_complete: false,
      prompt_error: null,
      nodeName: null,
      currentNodeId: null,
      currentNodeProgress: null,
      doneNodes: 0,
      cachedNodes: 0,
      totalNodes: state?.totalNodes || 0,
      startedAt: state?.startedAt || null,
      lastUpdateAt: state?.progressUpdatedAt || state?.updatedAt || null,
      completedAt: state?.readyAt || null,
      elapsedMs: null,
      estimatedRemainingMs: null,
      comfyBaseUrl,
      comfyClientId: state?.comfyClientId || null,
      fileName: state?.fileName || null,
      ownerKey: owner.ownerKey,
      scope: owner.scope,
      username: owner.username,
      deviceId: owner.deviceId,
      error: String(e?.message || e),
    });
  }
}
