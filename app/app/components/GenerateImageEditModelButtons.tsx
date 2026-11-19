"use client";

import React, {useEffect, useState} from "react";
import type {NativeEditEngine} from "@/lib/client/nativeImages";

export default function GenerateImageEditModelButtons({value, onChange, disabled, referenceCount = 1}: {
  value: NativeEditEngine; onChange: (value: NativeEditEngine) => void; disabled?: boolean; referenceCount?: number;
}) {
  const [h3Available, setH3Available] = useState<boolean | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    async function check() {
      try {
        const response = await fetch("/api/images/native/h3-support", {cache: "no-store", signal: abort.signal});
        const support = response.ok && (await response.json()).edit === true;
        if (!abort.signal.aborted) setH3Available(support);
      } catch {
        if (!abort.signal.aborted) setH3Available(false);
      }
    }
    void check();
    return () => abort.abort();
  }, []);
  const fibo = value === "fibo2-edit-turbo" || value === "fibo2-dev";
  const button = "min-h-11 rounded-lg border border-white/20 px-3 aria-pressed:border-cyan-300 aria-pressed:bg-cyan-400/20 disabled:opacity-45";
  return <fieldset disabled={disabled} className="my-3 space-y-2 text-sm">
    <legend>Edit model</legend>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={referenceCount > 3} aria-pressed={value === "qwen-edit-2509"} onClick={() => onChange("qwen-edit-2509")}>Qwen Image Edit 2509</button>
      <button type="button" className={button} disabled={referenceCount > 4} aria-pressed={fibo} onClick={() => onChange("fibo2-edit-turbo")}>FIFO</button>
      <button type="button" className={button} disabled={h3Available !== true || referenceCount > 4} aria-pressed={value === "h3-image-edit"} onClick={() => onChange("h3-image-edit")}>H3 Edit Image</button>
    </div>
    {h3Available === false && <p className="text-xs text-white/65">H3 Edit Image requires the official checkpoint and VAE on a compatible TEST worker.</p>}
    {value === "qwen" && <p className="text-xs text-white/65">This draft uses the saved Qwen Image 2.1 model.</p>}
    {fibo && <label className="block text-xs">Fibo variant
      <select value={value} onChange={event => onChange(event.target.value as NativeEditEngine)} className="ml-2 min-h-11 rounded-lg border border-white/20 bg-zinc-950 px-3 text-white">
        <option value="fibo2-edit-turbo">Turbo · 4 steps</option><option value="fibo2-dev">Dev · 50 steps</option>
      </select>
    </label>}
    {referenceCount > 3 && <p role="status" className="text-xs text-white/65">Qwen 2509 accepts up to 3 images. Fibo accepts up to 4.</p>}
  </fieldset>;
}
