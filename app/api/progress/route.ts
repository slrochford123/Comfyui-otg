import { NextRequest } from "next/server";
import { resolveComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { markError, readState, resetState } from "@/lib/contentState";
import { newestPromptIdForOwner, syncPromptOutputsForOwner } from "@/lib/comfyGallerySync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const { baseUrl } = await resolveComfyBaseUrl();
  const comfyBaseUrl = baseUrl.replace(/\/+$/, "");
  const state = readState(owner.ownerKey);

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
    const prompt_id =
      String(state?.promptId || "").trim() ||
      newestPromptIdForOwner(owner.ownerKey, owner.deviceId) ||
      null;

    let prompt_error: string | null = null;
    let prompt_complete = false;

    if (prompt_id) {
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

    if (prompt_error) {
      markError(owner.ownerKey, prompt_error);
    }

    const nextState = readState(owner.ownerKey);

    let status: "idle" | "running" | "complete" | "error" = "idle";
    if (prompt_error || nextState?.status === "error") {
      status = "error";
    } else if (nextState?.status === "done" || prompt_complete) {
      status = "complete";
    } else if (nextState?.status === "running" || queue_remaining > 0 || !!prompt_id) {
      status = "running";
    }

    if (status === "idle" && nextState?.status === "running" && !prompt_id) {
      resetState(owner.ownerKey);
    }

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
      pct: status === "complete" ? 100 : 0,
      nodeName: null,
      doneNodes: 0,
      totalNodes: 0,
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
      prompt_id: state?.promptId || null,
      prompt_complete: false,
      prompt_error: null,
      fileName: state?.fileName || null,
      ownerKey: owner.ownerKey,
      scope: owner.scope,
      username: owner.username,
      deviceId: owner.deviceId,
      error: String(e?.message || e),
    });
  }
}
