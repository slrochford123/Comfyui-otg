"use client";

import { useCallback, useEffect, useState } from "react";

type GpuStatus = {
  host: string;
  services: {
    comfy8188: { state: string; http: string };
    h38189: { state: string; http: string };
  };
  gpu: { name: string; usedMiB: number | null; totalMiB: number | null };
};

type ApiResult = { ok?: boolean; status?: GpuStatus; error?: string };
type Action = "free" | "reset";

export default function AdminGpuControls() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [status, setStatus] = useState<GpuStatus | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/gpu-controls", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = (await response.json()) as ApiResult;
      if (!response.ok || !result.ok || !result.status) {
        throw new Error(result.error || `Status unavailable (${response.status})`);
      }
      setStatus(result.status);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to read GPU status.");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  async function run(action: Action) {
    if (busy) return;
    const warning = action === "free"
      ? "Stop ComfyUI on ports 8188 and 8189 and release its GPU memory? Active generations will be interrupted. ComfyUI will stay stopped."
      : "Restart ComfyUI on ports 8188 and 8189? Active generations will be interrupted.";
    if (!window.confirm(warning)) return;
    setBusy(action);
    setMessage(action === "free" ? "Stopping both ComfyUI services..." : "Restarting ComfyUI and checking readiness...");
    setError("");
    try {
      const response = await fetch("/api/admin/gpu-controls", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-otg-gpu-control": "1" },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json()) as ApiResult;
      if (!response.ok || !result.ok || !result.status) {
        throw new Error(result.error || `Operation failed (${response.status})`);
      }
      setStatus(result.status);
      setMessage(action === "free" ? "ComfyUI stopped. VRAM updated." : "Restart completed; both ComfyUI endpoints checked.");
    } catch (reason) {
      setMessage("");
      setError(reason instanceof Error ? reason.message : "GPU operation failed.");
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  const services = status?.services;
  const mib = status?.gpu;
  const total = mib?.totalMiB;
  const used = mib?.usedMiB;
  const allReady = services?.comfy8188.http === "ready" &&
    (services?.h38189.http === "ready" || services?.h38189.http === "not-applicable");
  return (
    <details
      className="relative z-[90] shrink-0"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-[10px] border border-violet-300/35 bg-violet-300/10 px-3 py-2 text-xs font-bold text-violet-100 hover:bg-violet-300/20 [&::-webkit-details-marker]:hidden"
        aria-label="Admin GPU controls"
      >
        <span aria-hidden="true">◈</span> GPU<span className="hidden sm:inline"> Controls</span> <span aria-hidden="true">▾</span>
      </summary>
      <div className="absolute right-0 top-[calc(100%+8px)] z-[100] w-[min(330px,calc(100vw-20px))] rounded-xl border border-white/15 bg-[#111320] p-3 text-sm text-white shadow-2xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <strong>ComfyUI Management</strong>
          <span className="text-[10px] uppercase tracking-wide text-violet-200">Admin only</span>
        </div>
        <div className="mb-3 rounded-lg border border-white/10 bg-black/30 p-2 text-xs">
          <div className="mb-1 font-semibold">{status ? `GPU: ${status.gpu.name}` : "GPU status"}</div>
          <div>
            VRAM: {used !== null && used !== undefined && total !== null && total !== undefined
              ? `${(used / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} GB`
              : "Unavailable"}
          </div>
          <div className="mt-1">
            8188: {services?.comfy8188.state || "Unknown"} / {services?.comfy8188.http || "Unknown"}
          </div>
          <div>8189: {services?.h38189.state || "Unknown"} / {services?.h38189.http || "Unknown"}</div>
          {status ? (
            <div className="mt-1 text-white/60">{allReady ? "Both ComfyUI endpoints ready" : "One or both endpoints offline"} · {status.host}</div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void run("free")}
            disabled={Boolean(busy)}
            className="rounded-lg border border-amber-400/35 bg-amber-500/10 px-2 py-2.5 text-xs font-semibold hover:bg-amber-500/20 disabled:cursor-wait disabled:opacity-50"
          >
            {busy === "free" ? "Freeing..." : "Free VRAM"}
          </button>
          <button
            type="button"
            onClick={() => void run("reset")}
            disabled={Boolean(busy)}
            className="rounded-lg border border-sky-400/35 bg-sky-500/10 px-2 py-2.5 text-xs font-semibold hover:bg-sky-500/20 disabled:cursor-wait disabled:opacity-50"
          >
            {busy === "reset" ? "Restarting..." : "Reset ComfyUI"}
          </button>
        </div>
        <button type="button" className="mt-2 text-xs text-white/65 underline hover:text-white" onClick={() => void refresh()} disabled={Boolean(busy)}>
          Refresh GPU status
        </button>
        {message ? <p className="mt-2 text-xs text-emerald-200" role="status">{message}</p> : null}
        {error ? <p className="mt-2 text-xs text-red-300" role="alert">{error}</p> : null}
      </div>
    </details>
  );
}
