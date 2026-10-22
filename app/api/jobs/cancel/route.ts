import { NextRequest } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { resolveComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { markError, readState } from "@/lib/contentState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function promptIdFromQueueEntry(entry: unknown): string {
  if (Array.isArray(entry)) {
    return String(entry[1] || entry[0] || "").trim();
  }
  if (entry && typeof entry === "object") {
    const value = entry as Record<string, unknown>;
    return String(value.prompt_id || value.promptId || value.id || "").trim();
  }
  return "";
}

export async function POST(req: NextRequest) {
  try {
    // Ensure caller is authenticated/has a valid session (OTG Law: whoami governs auth state)
    const owner = await getOwnerContext(req);

    const body = await req.json().catch(() => ({}));
    const promptId = String(body?.promptId || body?.prompt_id || "").trim();
    if (!promptId) {
      return Response.json({ ok: false, error: "Missing promptId" }, { status: 400 });
    }

    const state = readState(owner.ownerKey);
    if (String(state?.promptId || "").trim() !== promptId || state?.status !== "running") {
      return Response.json({ ok: false, error: "This generation is no longer active for the current TEST session." }, { status: 409 });
    }

    const configured = String(state?.comfyBaseUrl || "").trim();
    const comfyBaseUrl = (configured || (await resolveComfyBaseUrl()).baseUrl).replace(/\/+$/, "");
    const queueResponse = await fetch(`${comfyBaseUrl}/queue`, { cache: "no-store" });
    if (!queueResponse.ok) {
      return Response.json({ ok: false, error: `ComfyUI queue could not be inspected (${queueResponse.status}).` }, { status: 502 });
    }
    const queue = await queueResponse.json().catch(() => ({}));
    const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending : Array.isArray(queue?.pending) ? queue.pending : [];
    const running = Array.isArray(queue?.queue_running) ? queue.queue_running : Array.isArray(queue?.running) ? queue.running : [];
    const isPending = pending.some((entry: unknown) => promptIdFromQueueEntry(entry) === promptId);
    const isRunning = running.some((entry: unknown) => promptIdFromQueueEntry(entry) === promptId);

    if (!isPending && !isRunning) {
      return Response.json({ ok: false, error: "The generation is not present in the active TEST queue." }, { status: 409 });
    }

    const results: { mode: "queued" | "running"; deleted: boolean; interrupted: boolean } = {
      mode: isRunning ? "running" : "queued",
      deleted: false,
      interrupted: false,
    };

    if (isPending) {
      const deletedResponse = await fetch(`${comfyBaseUrl}/queue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delete: [promptId] }),
      });
      results.deleted = deletedResponse.ok;
    }

    if (isRunning) {
      // ComfyUI's public interrupt endpoint is process-wide. It is only called
      // after the queue confirmed that this exact owner-scoped prompt is the
      // active TEST job, never for an arbitrary or stale prompt id.
      const interruptedResponse = await fetch(`${comfyBaseUrl}/interrupt`, { method: "POST" });
      results.interrupted = interruptedResponse.ok;
    }

    if (!results.deleted && !results.interrupted) {
      return Response.json({ ok: false, error: "ComfyUI did not accept cancellation for this TEST generation." }, { status: 502 });
    }

    markError(owner.ownerKey, "Generation cancelled by the user.");
    return Response.json({ ok: true, promptId, results }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
