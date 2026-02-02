"use client";

import * as React from "react";
import type { RatioKey, SizeKey, VideoProfileSelection, VideoProfileConstraints } from "@/lib/videoProfiles";
import { detectRatioFromPrompt, resolveVideoProfile } from "@/lib/videoProfiles";

type Props = {
  value: VideoProfileSelection;
  onChange: (next: VideoProfileSelection) => void;

  // Optional preset-level constraints (from workflow meta.profile)
  constraints?: VideoProfileConstraints;

  // Optional live prompt text (for Auto preview label + auto choice)
  promptText?: string;

  // Optional hint (mobile-safe defaults). If not provided, we won't force anything client-side.
  userAgent?: string;
};

const RATIO_LABEL: Record<Exclude<RatioKey, "auto">, string> = {
  landscape: "Landscape (16:9)",
  portrait: "Portrait (9:16)",
  square: "Square (1:1)",
  cinematic: "Cinematic (2.39:1)",
  ultra: "Ultra (1536×864 max)",
};

const SIZE_LABEL: Record<SizeKey, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large (720p)",
};

function isDisabledRatio(r: RatioKey, c?: VideoProfileConstraints) {
  if (!c?.allowedRatios || c.allowedRatios.length === 0) return false;
  return !c.allowedRatios.includes(r);
}

function isDisabledSize(s: SizeKey, c?: VideoProfileConstraints) {
  if (!c?.allowedSizes || c.allowedSizes.length === 0) return false;
  return !c.allowedSizes.includes(s);
}

export function RatioProfilePicker({ value, onChange, constraints, promptText, userAgent }: Props) {
  const locked = constraints?.lockRatio;

  const resolved = React.useMemo(() => {
    return resolveVideoProfile({
      selection: value,
      constraints,
      positivePrompt: promptText || "",
      userAgent: userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : null),
    });
  }, [value, constraints, promptText, userAgent]);

  const autoSuggestion = React.useMemo<Exclude<RatioKey, "auto">>(() => detectRatioFromPrompt(promptText || ""), [promptText]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Ratio profile</div>
        <div className="text-xs opacity-80">
          Output: <span className="font-mono">{resolved.width}×{resolved.height}</span>
          {resolved.isMobileDefault ? <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5">mobile default</span> : null}
        </div>
      </div>

      {/* Ratio buttons */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <button
          type="button"
          disabled={!!locked}
          onClick={() => onChange({ ...value, ratio: "auto" })}
          className={[
            "rounded-xl px-3 py-2 text-left border",
            value.ratio === "auto" ? "border-white/30 bg-white/10" : "border-white/10 hover:bg-white/10",
            locked ? "opacity-60 cursor-not-allowed" : ""
          ].join(" ")}
        >
          <div className="text-sm font-medium">Auto</div>
          <div className="text-xs opacity-80">Suggests: {RATIO_LABEL[autoSuggestion]}</div>
        </button>

        {(Object.keys(RATIO_LABEL) as Array<Exclude<RatioKey, "auto">>).map((r) => {
          const disabled = !!locked || isDisabledRatio(r, constraints);
          const active = (value.ratio || (constraints?.defaultRatio ?? "auto")) === r;
          return (
            <button
              key={r}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, ratio: r })}
              className={[
                "rounded-xl px-3 py-2 text-left border",
                active ? "border-white/30 bg-white/10" : "border-white/10 hover:bg-white/10",
                disabled ? "opacity-60 cursor-not-allowed" : ""
              ].join(" ")}
            >
              <div className="text-sm font-medium">{RATIO_LABEL[r]}</div>
              {constraints?.lockRatio === r ? <div className="text-xs opacity-80">locked</div> : <div className="text-xs opacity-80">&nbsp;</div>}
            </button>
          );
        })}
      </div>

      {/* Size buttons */}
      <div className="space-y-2">
        <div className="text-sm font-semibold">Size</div>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(SIZE_LABEL) as SizeKey[]).map((s) => {
            const disabled = isDisabledSize(s, constraints);
            const active = (value.size || constraints?.defaultSize) === s;
            return (
              <button
                key={s}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...value, size: s })}
                className={[
                  "rounded-xl px-3 py-2 text-center border",
                  active ? "border-white/30 bg-white/10" : "border-white/10 hover:bg-white/10",
                  disabled ? "opacity-60 cursor-not-allowed" : ""
                ].join(" ")}
              >
                <div className="text-sm font-medium">{SIZE_LABEL[s]}</div>
              </button>
            );
          })}
        </div>
        <div className="text-xs opacity-75">
          Tip: Large is best quality but slower. Mobile defaults to Medium unless you explicitly select Large.
        </div>
      </div>
    </div>
  );
}
