"use client";

import React, { useEffect, useMemo, useState } from "react";

export type ProductionStepKey =
  | "setup"
  | "characters"
  | "prompt"
  | "video"
  | "validation"
  | "stitch"
  | "review";

export type ProductionStepItem = {
  key: ProductionStepKey;
  index: number;
  label: string;
  complete?: boolean;
  locked?: boolean;
};

const EXPANDED_KEY = "otg:productionWidgetExpanded:v2";

export default function ProductionTaskWidget({
  steps,
  currentStep,
}: {
  steps: ProductionStepItem[];
  currentStep: ProductionStepKey;
}) {
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setExpanded(window.localStorage.getItem(EXPANDED_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  const currentMeta = useMemo(
    () => steps.find((step) => step.key === currentStep) || steps[0],
    [steps, currentStep]
  );

  const nextMeta = useMemo(() => {
    if (!currentMeta) return null;
    const currentIndex = steps.findIndex((step) => step.key === currentMeta.key);
    return currentIndex >= 0 ? steps[currentIndex + 1] || null : null;
  }, [steps, currentMeta]);

  if (!mounted || !currentMeta) return null;

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      window.localStorage.setItem(EXPANDED_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 22,
        bottom: 22,
        zIndex: 9998,
        userSelect: "none",
      }}
    >
      <button
        type="button"
        onClick={toggleExpanded}
        className="w-[214px] rounded-[24px] border border-cyan-400/30 bg-black/80 p-3 text-left shadow-[0_10px_40px_rgba(0,0,0,0.45)] backdrop-blur-md"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200/80">Production</div>
            <div className="mt-1 text-sm font-semibold text-white">Step {currentMeta.index}: {currentMeta.label}</div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/80">
            {expanded ? "Collapse" : "Expand"}
          </div>
        </div>
        {!expanded && nextMeta ? (
          <div className="mt-3 text-xs text-white/62">Next: {nextMeta.label}</div>
        ) : null}
      </button>

      {expanded ? (
        <div className="mt-3 w-[290px] rounded-[24px] border border-cyan-400/30 bg-black/80 p-3 shadow-[0_10px_40px_rgba(0,0,0,0.45)] backdrop-blur-md">
          <div className="mb-3 text-xs text-white/58">Guide only. Steps cannot be clicked from this widget.</div>
          <div className="space-y-2">
            {steps.map((step) => {
              const active = step.key === currentStep;
              return (
                <div
                  key={step.key}
                  className={[
                    "flex w-full items-center justify-between rounded-[18px] border px-3 py-2 text-left",
                    active
                      ? "border-cyan-300/45 bg-[linear-gradient(90deg,rgba(92,68,255,0.52),rgba(32,183,255,0.30))] text-white"
                      : step.complete
                        ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                        : step.locked
                          ? "border-white/10 bg-white/5 text-white/35"
                          : "border-white/10 bg-white/5 text-white/85",
                  ].join(" ")}
                >
                  <span className="flex items-center gap-3">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/35 text-xs font-black">
                      {step.index}
                    </span>
                    <span className="text-sm font-semibold">{step.label}</span>
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                    {step.complete ? "Done" : active ? "Current" : step.locked ? "Locked" : "Next"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
