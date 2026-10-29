import { NextRequest } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { GET as readProgress } from "@/app/api/progress/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner-scoped notifications. Never expose a caller-selected raw worker socket. */
export async function GET(req: NextRequest) {
  try { await getOwnerContext(req); }
  catch (error) {
    if (error instanceof SessionInvalidError) return Response.json({ error: "Unauthorized" }, { status: 401 });
    throw error;
  }
  const url = new URL(req.url);
  if (url.searchParams.has("clientId")) return Response.json({ error: "Raw worker subscriptions are not available." }, { status: 400 });
  const progressUrl = new URL("/api/progress", url.origin);
  for (const key of ["promptId", "prompt_id"]) {
    const value = url.searchParams.get(key);
    if (value) progressUrl.searchParams.set(key, value);
  }
  const progressRequest = new NextRequest(progressUrl, { headers: req.headers, signal: req.signal });
  const first = await readProgress(progressRequest);
  if (!first.ok) return first;
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let completedId = "";
      const finish = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        req.signal.removeEventListener("abort", finish);
        try { controller.close(); } catch {}
      };
      stop = finish;
      const send = (payload: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)); }
        catch { finish(); }
      };
      const emit = async (response: Response) => {
        const progress = await response.json();
        if (!response.ok) { send({ type: "session_error" }); finish(); return; }
        send({ type: "progress", prompt_id: progress.prompt_id, status: progress.status,
          percent: progress.progressPercent, node: progress.currentNodeId, retryable: progress.retryable === true });
        if (progress.prompt_complete && progress.prompt_id && completedId !== progress.prompt_id) {
          completedId = progress.prompt_id;
          send({ type: "execution_complete", prompt_id: progress.prompt_id, status: "completed" });
        }
      };
      const poll = async (response?: Response) => {
        try { await emit(response || await readProgress(progressRequest)); }
        catch { if (!req.signal.aborted) send({ type: "reconnecting", retryable: true }); }
        if (!closed) timer = setTimeout(() => { void poll(); }, 2_000);
      };
      req.signal.addEventListener("abort", finish, { once: true });
      if (req.signal.aborted) finish();
      else void poll(first);
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "private, no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
}
