import { NextRequest } from "next/server";
import { resolveComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { markError, readState, resetState } from "@/lib/contentState";
import { readComfyPromptProgress } from "@/lib/comfyProgress";
import { syncPromptOutputsForOwner } from "@/lib/comfyGallerySync";
import { readPromptRequestMeta } from "@/lib/promptRequestMeta";
import { readComfyQueue } from "@/lib/comfyTransport";
import { ensureComfyClientProgressMonitor, recordComfyPromptSubmitted } from "@/lib/comfyProgress";

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
  const knownProgress = readComfyPromptProgress(requestedPromptId || statePromptId);
  const requestMeta = requestedPromptId ? readPromptRequestMeta(owner.ownerKey, requestedPromptId) : null;
  if (requestedPromptId && requestedPromptId !== statePromptId
    && knownProgress?.ownerKey !== owner.ownerKey
    && (requestMeta?.ownerKey !== owner.ownerKey || requestMeta?.promptId !== requestedPromptId)) {
    return Response.json({ ok: false, error: "Generation not found" }, { status: 404 });
  }
  if (knownProgress?.ownerKey && knownProgress.ownerKey !== owner.ownerKey) {
    return Response.json({ ok: false, error: "Generation not found" }, { status: 404 });
  }

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
      approximatePreview: null,
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
  const isCurrentPrompt = prompt_id === statePromptId;
  const meta = requestMeta || (prompt_id ? readPromptRequestMeta(owner.ownerKey, prompt_id) : null);
  const comfyBaseUrl = String(knownProgress?.comfyBaseUrl || meta?.comfyBaseUrl || (isCurrentPrompt ? state?.comfyBaseUrl : null) || baseUrl)
    .trim()
    .replace(/\/+$/, "");
  const clientId = knownProgress?.clientId || meta?.comfyClientId || (isCurrentPrompt ? state?.comfyClientId : null);
  if (prompt_id && clientId) {
    if (!knownProgress) recordComfyPromptSubmitted({ promptId: prompt_id, ownerKey: owner.ownerKey,
      deviceId: owner.deviceId, clientId, comfyBaseUrl, totalNodes: meta?.totalNodes ?? state?.totalNodes });
    ensureComfyClientProgressMonitor({ comfyBaseUrl, clientId });
  }
  const comfyProgress = readComfyPromptProgress(prompt_id);

  try {
    const queueJson = await readComfyQueue(comfyBaseUrl, { signal: req.signal });

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
        updateCurrentState: isCurrentPrompt,
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

    if (prompt_error && isCurrentPrompt) {
      markError(owner.ownerKey, prompt_error);
    }

    const nextState = readState(owner.ownerKey);

    // A worker can disappear after admission (for example, a ComfyUI restart)
    // leaving the durable owner state marked running even though the prompt is
    // no longer queued and has no history result. Do not keep the Android UI
    // in an infinite Running state; allow a short admission/grace window first.
    const startedAtMs = Number(nextState?.startedAt || state?.startedAt || 0);
    const staleWithoutQueue =
      !!prompt_id &&
      isCurrentPrompt &&
      queue_remaining === 0 &&
      nextState?.status === "running" &&
      !prompt_complete &&
      !prompt_error &&
      startedAtMs > 0 &&
      Date.now() - startedAtMs > 30_000;
    if (staleWithoutQueue) {
      prompt_error = "The generation worker stopped before returning a result. Retry the generation.";
      markError(owner.ownerKey, prompt_error);
    }

    let status: "idle" | "running" | "complete" | "error" = "idle";
    if (prompt_error || (isCurrentPrompt && nextState?.status === "error")) {
      status = "error";
    } else if ((isCurrentPrompt && nextState?.status === "done") || prompt_complete) {
      status = "complete";
    } else if (
      (isCurrentPrompt && nextState?.status === "running") ||
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
          : Math.min(99, clampPercent(comfyProgress?.percent ?? nextState?.progressPercent ?? 0));

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
      approximatePreview: status === "running" ? comfyProgress?.approximatePreview || null : null,
      fileName: isCurrentPrompt ? nextState?.fileName || null : null,
      ownerKey: owner.ownerKey,
      scope: owner.scope,
      username: owner.username,
      deviceId: owner.deviceId,
    });
  } catch (e: any) {
    return Response.json({
      ok: false,
      status: "reconnecting",
      running: true,
      queue: 0,
      queue_remaining: 0,
      pct: Math.min(99, comfyProgress?.percent ?? state?.progressPercent ?? 0),
      percent: Math.min(99, comfyProgress?.percent ?? state?.progressPercent ?? 0),
      progressPercent: Math.min(99, comfyProgress?.percent ?? state?.progressPercent ?? 0),
      prompt_id,
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
      approximatePreview: null,
      fileName: state?.fileName || null,
      ownerKey: owner.ownerKey,
      scope: owner.scope,
      username: owner.username,
      deviceId: owner.deviceId,
      error: String(e?.message || e),
      retryable: true,
    });
  }
}
