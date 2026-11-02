import { withOwner, RequestError } from "@/lib/routeSecurity";
import { readPromptRequestMeta } from "@/lib/promptRequestMeta";
import { configuredImageComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeOwnedQueue(rows: unknown, ownerKey: string) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    const promptId = Array.isArray(row) ? row[1] : row && typeof row === "object" ? (row as Record<string, unknown>).prompt_id : null;
    if (typeof promptId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(promptId)) return [];
    const meta = readPromptRequestMeta(ownerKey, promptId);
    return meta?.ownerKey === ownerKey && meta.promptId === promptId ? [{ prompt_id: promptId }] : [];
  });
}
export const GET = withOwner(async (request, owner) => {
  const response = await fetch(configuredImageComfyBaseUrl().replace(/\/+$/, "") + "/queue", { cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]) });
  if (!response.ok) throw new RequestError("Worker queue is temporarily unavailable.", 503);
  const queue = await response.json();
  return Response.json({ ok: true, ownerKey: owner.ownerKey,
    running: normalizeOwnedQueue(queue.queue_running ?? queue.running, owner.ownerKey),
    pending: normalizeOwnedQueue(queue.queue_pending ?? queue.pending, owner.ownerKey) });
});
