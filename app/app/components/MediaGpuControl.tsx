"use client";
import React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { MEDIA_GPU_COOKIE, parseMediaGpuChoice, type MediaGpuChoice } from "@/lib/mediaGpuRouting";

const event = "otg-media-gpu-change";
export const MEDIA_GPU_ROUTING_UI_ENABLED=process.env.NEXT_PUBLIC_OTG_MEDIA_GPU_ROUTING === "1";
function snapshot(): MediaGpuChoice {
  if(!MEDIA_GPU_ROUTING_UI_ENABLED)return "auto";
  try {
    const value = document.cookie.split("; ").find(cookie => cookie.startsWith(MEDIA_GPU_COOKIE + "="))?.split("=")[1];
    return parseMediaGpuChoice(value);
  } catch {return "auto";}
}
function subscribe(update: () => void) {
  window.addEventListener(event, update);
  window.addEventListener("focus", update);
  return () => { window.removeEventListener(event, update); window.removeEventListener("focus", update); };
}
export function useMediaGpuChoice() {
  const choice = useSyncExternalStore(subscribe, snapshot, () => "auto" as MediaGpuChoice);
  return [choice, (value: MediaGpuChoice) => {
    document.cookie = `${MEDIA_GPU_COOKIE}=${value}; Path=/; SameSite=Lax; Max-Age=31536000${location.protocol === "https:" ? "; Secure" : ""}`;
    window.dispatchEvent(new Event(event));
  }] as const;
}
export default function MediaGpuControl({ disabled = false, onManualGpu, buttonRouting = false }: {disabled?: boolean; buttonRouting?: boolean; onManualGpu?: (gpu: Exclude<MediaGpuChoice,"auto">) => void}) {
  const [choice, setChoice] = useMediaGpuChoice();
  const [enabled,setEnabled]=useState(false);
  const [queue,setQueue]=useState<Array<{gpu:string;label:string;ready:boolean;reason:string;queued:number}>>([]);
  useEffect(()=>{
    if(!MEDIA_GPU_ROUTING_UI_ENABLED)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function refresh(){
      try{
        const response=await fetch("/api/media-gpu",{credentials:"include",cache:"no-store",signal:controller.signal});
        const data=await response.json();
        if(!controller.signal.aborted){setEnabled(response.ok&&data.enabled===true);setQueue(data.devices||[]);}
      }catch{/* Keep the current preference; an outage must never switch GPUs. */}
      if(!controller.signal.aborted)timer=setTimeout(refresh,6000);
    }
    void refresh();return()=>{controller.abort();clearTimeout(timer);};
  },[]);
  useEffect(() => { if (choice !== "auto") onManualGpu?.(choice); }, [choice, onManualGpu]);
  if(!MEDIA_GPU_ROUTING_UI_ENABLED||!enabled)return null;
  const selectable = (gpu: MediaGpuChoice) => {
    const device = queue.find(item => item.gpu === gpu);
    // Occupied workers can still accept a queued job.
    return device && !/cannot be confirmed|telemetry unavailable/i.test(device.reason);
  };
  const manualDevices = ["rtx5060ti", "rtx3090"] as const;
  const defaultManual = manualDevices.find(selectable);
  const selection = "min-h-11 rounded-lg border border-white/20 px-3 font-semibold aria-pressed:border-cyan-300 aria-pressed:bg-cyan-400/20 disabled:opacity-40";
  if (buttonRouting) return <fieldset disabled={disabled} className="rounded-xl border border-white/15 p-3 text-sm">
    <legend className="px-1 font-semibold">Rendering GPU</legend>
    <div role="group" aria-label="GPU routing" className="flex flex-wrap gap-2">
      <button type="button" className={selection} aria-pressed={choice === "auto"} onClick={() => setChoice("auto")}>Automatic</button>
      <button type="button" className={selection} aria-pressed={choice !== "auto"} disabled={choice === "auto" && !defaultManual}
        onClick={() => { if (choice === "auto" && defaultManual) setChoice(defaultManual); }}>Manual</button>
    </div>
    {choice !== "auto" && <div role="group" aria-label="Manual rendering GPU" className="mt-2 flex flex-wrap gap-2">
      {manualDevices.map(gpu => <button key={gpu} type="button" className={selection} aria-pressed={choice === gpu}
        disabled={!selectable(gpu)} onClick={() => setChoice(gpu)}>{gpu === "rtx5060ti" ? "RTX 5060 Ti" : "RTX 3090"}</button>)}
    </div>}
    <p role="status" className="mt-2 text-xs text-white/65">{queue.filter(device => device.gpu !== "rtx3060").map(device =>
      `${device.label}: ${device.ready ? "available" : selectable(device.gpu as MediaGpuChoice) ? device.reason : "unavailable"}${device.queued ? ` · ${device.queued} queued` : ""}`).join(" · ")}</p>
  </fieldset>;
  return <fieldset disabled={disabled} className="rounded-xl border border-white/15 p-3 text-sm">
    <legend className="px-1 font-semibold">Rendering GPU</legend>
    <div className="flex flex-wrap items-center gap-2">
      <label>Routing <select aria-label="Media GPU routing" className="min-h-11 rounded-lg bg-slate-900 px-2" value={choice === "auto" ? "auto" : "manual"}
        onChange={e => setChoice(e.target.value === "auto" ? "auto" : "rtx3090")}>
        <option value="auto">Automatic</option><option value="manual">Manual</option>
      </select></label>
      {choice !== "auto" ? <label>Device <select aria-label="Manual rendering GPU" className="min-h-11 rounded-lg bg-slate-900 px-2" value={choice}
        onChange={e => setChoice(parseMediaGpuChoice(e.target.value))}>
        <option value="rtx3090">RTX 3090</option><option value="rtx5060ti">RTX 5060 Ti</option>
      </select></label> : null}
    </div>
    <p className="mt-1 text-xs text-white/65">{choice === "auto" ? "3090 first; use the 5060 Ti when busy. Compatible jobs queue when both are occupied." : "Jobs queue on this GPU only; no automatic device changes."} CPU-only editing stays on the CPU.</p>
    <p role="status" className="mt-1 text-xs text-white/65">{queue.map(device=>`${device.label}: ${device.ready?"available":"occupied / checking"}${device.queued?` · ${device.queued} queued`:""}`).join(" · ")}</p>
  </fieldset>;
}
