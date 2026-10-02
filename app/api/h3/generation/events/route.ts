import type { NextRequest } from "next/server";

import { h3LivePreviewEnabled, subscribeH3Preview } from "@/lib/h3PreviewBroker";
import { getOwnerContext } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const PREVIEW_SESSION_WAIT_MS = 15_000;
const PREVIEW_SESSION_RETRY_MS = 250;

export async function GET(req: NextRequest) {
  if (!h3LivePreviewEnabled()) return new Response(null, { status: 404 });
  const owner = await getOwnerContext(req);
  const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, value: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
      };
      const deadline = Date.now() + PREVIEW_SESSION_WAIT_MS;
      const cleanup = () => {
        if (retryTimer) clearTimeout(retryTimer);
        if (keepAlive) clearInterval(keepAlive);
        unsubscribe?.();
      };
      const attach = () => {
        if (req.signal.aborted) return cleanup();
        unsubscribe = subscribeH3Preview(jobId, owner.ownerKey, (event) => send(event.type, event));
        if (unsubscribe) {
          send("connection", { type: "connection", state: "connected" });
          keepAlive = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 15_000);
          keepAlive.unref?.();
          return;
        }
        if (Date.now() >= deadline) {
          send("connection", { type: "connection", state: "unavailable" });
          controller.close();
          return;
        }
        retryTimer = setTimeout(attach, PREVIEW_SESSION_RETRY_MS);
        retryTimer.unref?.();
      };
      attach();
      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch {}
      }, { once: true });
    },
    cancel() {
      if (retryTimer) clearTimeout(retryTimer);
      if (keepAlive) clearInterval(keepAlive);
      unsubscribe?.();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
