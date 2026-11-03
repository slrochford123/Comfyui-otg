"use client";
import React from "react";
import type {NativeEditEngine} from "@/lib/client/nativeImages";
export default function ImageEditEngineSelect({value, onChange, disabled, referenceCount = 1}: {value: NativeEditEngine; onChange: (value: NativeEditEngine) => void; disabled?: boolean; referenceCount?: number}) {
  return <div className="my-3 space-y-2 text-sm"><label className="block">Edit model
    <select value={value === "qwen" ? "qwen" : "fibo"} disabled={disabled} onChange={event => onChange(event.target.value === "qwen" ? "qwen" : "fibo2-edit-turbo")} className="mt-1 min-h-11 w-full rounded-lg border border-white/20 bg-zinc-950 px-3 text-white">
      <option value="qwen">Qwen 2.1</option>
      <option value="fibo" disabled={referenceCount > 4}>Fibo{referenceCount > 4 ? " · maximum 4 images" : ""}</option>
    </select>
    </label>
    {value !== "qwen" ? <><label className="block text-xs">Fibo variant<select value={value} disabled={disabled} onChange={event => onChange(event.target.value as NativeEditEngine)} className="ml-2 min-h-11 rounded-lg border border-white/20 bg-zinc-950 px-3 text-white"><option value="fibo2-edit-turbo">Turbo · 4 steps</option><option value="fibo2-dev">Dev · 50 steps</option></select></label><p className="text-xs text-amber-200">Local Fibo · non-commercial research. Original image is kept.</p></> : <p className="text-xs text-white/60">Qwen Image Edit 2.1 Turbo · 8 steps</p>}
    {referenceCount > 1 ? <p className="text-xs text-white/60">Qwen: up to 16 images. Fibo: up to 4 total. Image 1 is the original.</p> : null}
  </div>;
}
