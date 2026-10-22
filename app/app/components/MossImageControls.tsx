"use client";
import React, { useEffect, useState } from "react";
import type { MossTarget } from "@/lib/images/mossImage";

export type MossImageSettings = { gpuTarget: MossTarget; width: number; height: number; seed: string; negativePrompt: string };
export function defaultMossSettings(kind: "character" | "background" | "asset"): MossImageSettings {
  const [width, height] = kind === "character" ? [768, 1344] : kind === "background" ? [1344, 768] : [1024, 1024];
  return { gpuTarget: "5060ti", width, height, seed: "", negativePrompt: "" };
}
export default function MossImageControls({ value, onChange, disabled = false }: { value: MossImageSettings; onChange: (value: MossImageSettings) => void; disabled?: boolean }) {
  const [status, setStatus] = useState("Checking MOSS worker…");
  useEffect(() => {
    const controller = new AbortController();
    if (disabled) { setStatus("Busy — this MOSS operation is in progress."); return () => controller.abort(); }
    setStatus("Checking MOSS worker…");
    const refresh = () => fetch(`/api/images/moss-status?target=${value.gpuTarget}`, { signal: controller.signal, credentials: "include", cache: "no-store" })
      .then(async response => { const result = await response.json(); if (!response.ok) throw Error(result.error || "MOSS status unavailable"); if (!controller.signal.aborted) setStatus(result.message); })
      .catch(error => { if (!controller.signal.aborted) setStatus(error.message); });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [value.gpuTarget, disabled]);
  const change = (patch: Partial<MossImageSettings>) => onChange({ ...value, ...patch });
  const field = "mt-1 min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3 text-[var(--color-text)]";
  return <fieldset disabled={disabled} className="my-4 space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-otg="moss-image-controls">
    <legend className="px-2 font-semibold">MOSS-Image SFT</legend>
    <label className="block">GPU<select aria-label="MOSS GPU" className={field} value={value.gpuTarget} onChange={event => change({ gpuTarget: event.target.value as MossTarget })}><option value="5060ti">RTX 5060 Ti</option><option value="3090">RTX 3090</option></select></label>
    <p role="status" className="text-sm text-[var(--color-text-muted)]">{status}</p>
    <label className="block">Output shape<select aria-label="MOSS output shape" className={field} value={`${value.width}x${value.height}`} onChange={event => { const [width, height] = event.target.value.split("x").map(Number); change({ width, height }); }}><option value="768x1344">Portrait · 768 × 1344</option><option value="1344x768">Landscape · 1344 × 768</option><option value="1024x1024">Square · 1024 × 1024</option></select></label>
    <label className="block">Seed (blank for random)<input aria-label="MOSS seed" inputMode="numeric" className={field} value={value.seed} onChange={event => change({ seed: event.target.value })} /></label>
    <label className="block">Negative prompt (optional)<textarea aria-label="MOSS negative prompt" rows={2} className={field} value={value.negativePrompt} onChange={event => change({ negativePrompt: event.target.value })} /></label>
    <p className="text-xs text-[var(--color-text-muted)]">SFT INT8 · 50 steps · CFG 3 · native ComfyUI memory offload. The selected GPU is used without fallback.</p>
  </fieldset>;
}
