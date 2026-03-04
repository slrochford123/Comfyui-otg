import { NextResponse } from "next/server";
import { resolveComfyBaseUrl } from "@/app/api/_lib/comfyTarget";

export const runtime = "nodejs";

function toWsBase(httpBase: string) {
  return httpBase
    .replace(/^http:/i, "ws:")
    .replace(/^https:/i, "wss:")
    .replace(/\/+$/, "");
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId") || "cid_default";

  const { baseUrl } = await resolveComfyBaseUrl();
  const base = baseUrl;
  const wsUrl = `${toWsBase(base)}/ws?clientId=${encodeURIComponent(clientId)}`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      // IMPORTANT: do NOT double-stringify WebSocket JSON strings
      const send = (payload: any) => {
        if (closed) return;
        const line =
          typeof payload === "string" ? payload : JSON.stringify(payload);
        try {
          controller.enqueue(encoder.encode(`data: ${line}\n\n`));
        } catch {
          closed = true;
        }
      };

      send(["__open", { wsUrl }]);

      let ws: WebSocket | null = null;

      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => send(["__ws_open", {}]);

        ws.onmessage = (ev) => {
          // ev.data is already a JSON string from ComfyUI
          send(ev.data);
        };

        ws.onerror = () =>
          send(["__error", { message: "WebSocket error to ComfyUI" }]);

        ws.onclose = () => {
          send(["__close", {}]);
          if (!closed) {
            closed = true;
            try { controller.close(); } catch {}
          }
        };
      } catch (e: any) {
        send(["__error", { message: String(e?.message ?? e), wsUrl }]);
        if (!closed) {
          closed = true;
          try { controller.close(); } catch {}
        }
      }

      // When browser disconnects
      (controller as any).signal?.addEventListener?.("abort", () => {
        try { ws?.close(); } catch {}
        if (!closed) {
          closed = true;
          try { controller.close(); } catch {}
        }
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
