"use client";

import React from "react";

export type ProductionAnimateMode = "default" | "director";

export default function ProductionAnimateModeSwitch({
  mode,
  onChange,
}: {
  mode: ProductionAnimateMode;
  onChange: (mode: ProductionAnimateMode) => void;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.2em] text-cyan-200/75">Animate Mode</div>
          <div className="mt-1 text-sm text-white/55">Choose the renderer for the Animate step only.</div>
        </div>
        <div className="flex rounded-full border border-white/10 bg-black/45 p-1">
          <button
            type="button"
            onClick={() => onChange("default")}
            className={[
              "rounded-full px-4 py-2 text-sm font-black transition",
              mode === "default"
                ? "bg-white text-black"
                : "text-white/70 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            Default Mode
          </button>
          <button
            type="button"
            onClick={() => onChange("director")}
            className={[
              "rounded-full px-4 py-2 text-sm font-black transition",
              mode === "director"
                ? "bg-[linear-gradient(90deg,rgba(111,76,255,0.95),rgba(32,183,255,0.9))] text-white"
                : "text-white/70 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            Director Mode
          </button>
        </div>
      </div>
    </div>
  );
}