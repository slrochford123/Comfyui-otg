"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

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
  const [target,setTarget]=useState<'3090'|'5060ti'>('3090');
  const operationRef=useRef(false);
  const statusRequest=useRef(0);
  const [busy, setBusy] = useState<Action | null>(null);
  const [status, setStatus] = useState<GpuStatus | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const requestId=++statusRequest.current;
    try {
      const response = await fetch(`/api/admin/gpu-controls?target=${target}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = (await response.json()) as ApiResult;
      if(requestId!==statusRequest.current)return;
      if (!response.ok || !result.ok || !result.status) {
        throw new Error(result.error || `Status unavailable (${response.status})`);
      }
      setStatus(result.status);
      setError("");
    } catch (reason) {
      if(requestId!==statusRequest.current)return;
      setStatus(null);
      setError(reason instanceof Error ? reason.message : "Unable to read GPU status.");
    }
  }, [target]);
  useEffect(()=>{statusRequest.current++;setStatus(null);setMessage('');setError('');},[target]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  async function run(action: Action) {
    if (operationRef.current) return;
    const gpuName=target==='3090'?'RTX 3090':'RTX 5060 Ti';
    const warning = action === "free"
      ? `Stop ${gpuName} ComfyUI and release its GPU memory? The worker will stay stopped until Reset ComfyUI. Busy workers are refused.`
      : `Restart ${gpuName} ComfyUI and wait for readiness? Busy workers are refused.`;
    if (!window.confirm(warning)) return;
    operationRef.current=true;
    setBusy(action);
    setMessage(action === "free" ? `Stopping ${gpuName} ComfyUI...` : `Restarting ${gpuName} ComfyUI and checking readiness...`);
    setError("");
    try {
      const response = await fetch("/api/admin/gpu-controls", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-otg-gpu-control": "1" },
        body: JSON.stringify({ action,target }),
      });
      const result = (await response.json()) as ApiResult;
      if (!response.ok || !result.ok || !result.status) {
        throw new Error(result.error || `Operation failed (${response.status})`);
      }
      setStatus(result.status);
      setMessage(action === "free" ? `${gpuName} ComfyUI stopped. VRAM updated.` : `${gpuName} restart completed; worker readiness confirmed.`);
    } catch (reason) {
      setMessage("");
      setError(reason instanceof Error ? reason.message : "GPU operation failed.");
    } finally {
      operationRef.current=false;
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
  const anyBusy = services?.comfy8188.http === "busy" || services?.h38189.http === "busy";
  const unverified = services?.comfy8188.http === "unverified" || services?.h38189.http === "unverified";
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
      <div className="fixed left-3 right-3 top-[calc(var(--otg-shared-header-height,160px)+8px)] z-[100] max-h-[calc(100dvh-var(--otg-shared-header-height,160px)-100px)] overflow-y-auto rounded-xl border border-white/15 bg-[#111320] p-3 text-sm text-white shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-[330px]" role="group" aria-label="GPU maintenance panel">
        <div className="mb-2 flex items-center justify-between gap-2">
          <strong>ComfyUI Management</strong>
          <span className="text-[10px] uppercase tracking-wide text-violet-200">Admin only</span>
        </div>
        <label className="mb-3 block text-xs font-semibold">Target GPU
          <select aria-label="Maintenance target GPU" value={target} disabled={Boolean(busy)} onChange={e=>setTarget(e.target.value as '3090'|'5060ti')} className="mt-1 w-full rounded-lg border border-white/20 bg-[#111320] p-2 text-white">
            <option value="3090">RTX 3090</option><option value="5060ti">RTX 5060 Ti</option>
          </select>
        </label>
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
          {target==='3090'?<div>8189: {services?.h38189.state || "Unknown"} / {services?.h38189.http || "Unknown"}</div>:null}
          {status ? (
            <div className="mt-1 text-white/60">{anyBusy ? "Busy — work queued or running" : allReady ? "Worker reachable; readiness checked" : "Worker is not ready"} · {status.host}</div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void run("free")}
            disabled={Boolean(busy) || !status || anyBusy || unverified}
            className="rounded-lg border border-amber-400/35 bg-amber-500/10 px-2 py-2.5 text-xs font-semibold hover:bg-amber-500/20 disabled:cursor-wait disabled:opacity-50"
          >
            {busy === "free" ? "Freeing..." : "Free VRAM"}
          </button>
          <button
            type="button"
            onClick={() => void run("reset")}
            disabled={Boolean(busy) || !status || anyBusy || unverified}
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
