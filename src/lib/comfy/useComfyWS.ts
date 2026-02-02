"use client";

import { useEffect, useRef, useState } from "react";
import { setProgressState } from "./progressStore";

type ComfyMsg =
  | { type: "status"; data?: any }
  | { type: "executing"; data?: any }
  | { type: "executed"; data?: any }
  | { type: "execution_start"; data?: any }
  | { type: "execution_error"; data?: any }
  | { [k: string]: any };

export type UseComfyWSOptions = {
  url: string;              // ws://host:8188/ws?clientId=...
  enabled?: boolean;        // default true
  onMessage?: (msg: ComfyMsg) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
};

/** Safe JSON parse (ComfyUI sometimes sends non-JSON lines) */
function safeJsonParse(raw: any) {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Lightweight ComfyUI websocket hook.
 * - No external store libs (zustand removed)
 * - Updates ./progressStore so any UI can subscribe if it wants
 */
export function useComfyWS(arg: string | UseComfyWSOptions) {
  const opts: UseComfyWSOptions =
    typeof arg === "string" ? { url: arg } : arg;

  const enabled = opts.enabled ?? true;

  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastEventTs, setLastEventTs] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    if (!opts.url) return;

    let closedByUs = false;

    const connect = () => {
      try {
        const ws = new WebSocket(opts.url);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          setProgressState({ connected: true, lastEventTs: Date.now() });
          opts.onConnected?.();
        };

        ws.onmessage = (evt) => {
          const msg = safeJsonParse(evt.data) ?? ({} as any);
          const ts = Date.now();
          setLastEventTs(ts);
          setProgressState({ lastEventTs: ts });

          // Any message means socket is alive
          if (!connected) {
            setConnected(true);
            setProgressState({ connected: true });
          }

          // Best-effort parsing of common Comfy events to keep state in sync
          const type = msg?.type ?? msg?.event ?? msg?.name;
          const data = msg?.data ?? msg?.payload ?? msg;

          if (type === "status") {
            const qrem = data?.status?.exec_info?.queue_remaining;
            if (typeof qrem === "number") {
              setProgressState({ queueRemaining: qrem });
            }
          }

          if (type === "execution_start" || type === "executing") {
            const promptId = data?.prompt_id ?? data?.promptId ?? null;
            setProgressState({
              phase: "running",
              activePromptId: promptId,
              message: "Running…",
            });
          }

          if (type === "executed") {
            // Completed a node; Comfy doesn't always provide a percent.
            // Keep percent stable unless caller computes it elsewhere.
            setProgressState({ message: "Processing…" });
          }

          if (type === "execution_error") {
            setProgressState({ phase: "error", message: "Error" });
          }

          opts.onMessage?.(msg);
        };

        ws.onclose = () => {
          wsRef.current = null;
          setConnected(false);
          setProgressState({ connected: false });
          opts.onDisconnected?.();

          if (!closedByUs) {
            // Reconnect after short delay
            setTimeout(connect, 1500);
          }
        };

        ws.onerror = () => {
          // Let onclose handle reconnect
        };
      } catch {
        // Retry connect
        setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      closedByUs = true;
      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.url, enabled]);

  return { connected, lastEventTs, ws: wsRef.current };
}

export default useComfyWS;
