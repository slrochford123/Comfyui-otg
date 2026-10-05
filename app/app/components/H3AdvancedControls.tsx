"use client";

import React from "react";

import {
  normalizeH3AdvancedSettings,
  selectH3CheckpointMode,
  selectH3RenderMode,
  type H3AdvancedSettings,
  type H3CheckpointMode,
  type H3RefModStrength,
  type H3RenderMode,
} from "@/lib/production/h3Settings";

type ReferenceOption = {
  label: string;
};

type Props = {
  value: H3AdvancedSettings;
  onChange: (value: H3AdvancedSettings) => void;
  referenceOptions?: ReferenceOption[];
  disabled?: boolean;
  variant?: "h3-panel" | "production";
};

const TOOLTIPS = {
  turbo: "Faster H3 rendering with reduced sampling.",
  native: "Higher-detail H3 rendering using native sampling.",
  singularity: "Alternative H3 model tuned for fluid motion and cinematic detail.",
  refMod: "Strengthen a selected visual reference.",
  motion: "Recover additional detail during fast movement.",
} as const;

export default function H3AdvancedControls({
  value,
  onChange,
  referenceOptions = [],
  disabled = false,
  variant = "h3-panel",
}: Props) {
  const settings = normalizeH3AdvancedSettings(value, referenceOptions.length);
  const buttonBase = variant === "production"
    ? "min-h-10 rounded-lg border px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-45"
    : "rounded-[8px] border px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-45";
  const activeClass = variant === "production"
    ? "production-v2-control-active"
    : "border-cyan-300 bg-cyan-300/10 text-white shadow-[0_0_18px_rgba(34,211,238,0.12)]";
  const inactiveClass = variant === "production"
    ? "border-white/10 bg-black/25 text-zinc-400 hover:border-white/25 hover:text-white"
    : "border-white/10 bg-black/25 text-white/55 hover:border-white/25 hover:text-white";

  const buttonClass = (active: boolean) =>
    `${buttonBase} ${active ? activeClass : inactiveClass}`;
  const refModAvailable = referenceOptions.length > 0;
  const referenceTarget =
    settings.refMod.targetReference ?? 0;

  function update(next: H3AdvancedSettings) {
    onChange(normalizeH3AdvancedSettings(next, referenceOptions.length));
  }

  function setRenderMode(renderMode: H3RenderMode) {
    onChange(selectH3RenderMode(settings, renderMode, referenceOptions.length));
  }

  function setCheckpointMode(checkpointMode: H3CheckpointMode) {
    onChange(selectH3CheckpointMode(settings, checkpointMode, referenceOptions.length));
  }

  function setRefModStrength(strength: H3RefModStrength) {
    update({
      ...settings,
      refMod: {
        ...settings.refMod,
        strength,
      },
    });
  }

  return (
    <div className="space-y-4" data-otg="h3-advanced-controls">
      <div>
        <div className="mb-2 text-xs font-black uppercase text-white/50">Render</div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="H3 render mode">
          <button type="button" title={TOOLTIPS.turbo} disabled={disabled} aria-pressed={settings.renderMode === "turbo"} className={buttonClass(settings.renderMode === "turbo")} onClick={() => setRenderMode("turbo")}>Turbo</button>
          <button type="button" title={TOOLTIPS.native} disabled={disabled} aria-pressed={settings.renderMode === "native"} className={buttonClass(settings.renderMode === "native")} onClick={() => setRenderMode("native")}>Native</button>
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs font-black uppercase text-white/50">Model</div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="H3 model">
          <button type="button" disabled={disabled} aria-pressed={settings.checkpointMode === "standard"} className={buttonClass(settings.checkpointMode === "standard")} onClick={() => setCheckpointMode("standard")}>Standard</button>
          <button type="button" title={TOOLTIPS.singularity} disabled={disabled} aria-pressed={settings.checkpointMode === "singularity"} className={buttonClass(settings.checkpointMode === "singularity")} onClick={() => setCheckpointMode("singularity")}>Singularity</button>
            {settings.checkpointMode === "singularity" ? (
              <label
                className="col-span-2 flex items-center gap-2 rounded-[8px] border border-white/10 bg-black/25 px-3 py-2 text-sm text-white/75"
                data-otg="h3-singularity-combat-toggle"
              >
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={settings.combatLoraEnabled}
                  onChange={(event) =>
                    update({
                      ...settings,
                      combatLoraEnabled: event.target.checked,
                    })
                  }
                />
                Combat LoRA
                <span className="ml-auto text-xs text-white/40">
                  Realism always on
                </span>
              </label>
            ) : null}
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs font-black uppercase text-white/50">Enhance</div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="H3 enhancements">
          <button
            type="button"
            title={TOOLTIPS.refMod}
            disabled={disabled || !refModAvailable}
            aria-pressed={settings.refMod.enabled}
            className={buttonClass(settings.refMod.enabled)}
            onClick={() => update({ ...settings, refMod: { ...settings.refMod, enabled: !settings.refMod.enabled } })}
          >
            RefMod
          </button>
          <button
            type="button"
            title={TOOLTIPS.motion}
            disabled={disabled}
            aria-pressed={settings.motionLab.enabled}
            className={buttonClass(settings.motionLab.enabled)}
            onClick={() => update({ ...settings, motionLab: { enabled: !settings.motionLab.enabled } })}
          >
            Motion
          </button>
        </div>
      </div>
      {settings.refMod.enabled ? (
        <div className="grid gap-4 sm:grid-cols-2" data-otg="h3-refmod-options">
          <div>
            <div className="mb-2 text-xs font-black uppercase text-white/50">Strength</div>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="RefMod strength">
              <button type="button" disabled={disabled} aria-pressed={settings.refMod.strength === "balanced"} className={buttonClass(settings.refMod.strength === "balanced")} onClick={() => setRefModStrength("balanced")}>Balanced</button>
              <button type="button" disabled={disabled} aria-pressed={settings.refMod.strength === "strong"} className={buttonClass(settings.refMod.strength === "strong")} onClick={() => setRefModStrength("strong")}>Strong</button>
            </div>
          </div>
          {referenceOptions.length > 1 ? (
            <div data-otg="h3-refmod-target">
              <div className="mb-2 text-xs font-black uppercase text-white/50">Target</div>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="RefMod target">
                {referenceOptions.map((reference, index) => (
                  <button
                    key={`${reference.label}-${index}`}
                    type="button"
                    disabled={disabled}
                    aria-pressed={referenceTarget === index}
                    className={buttonClass(referenceTarget === index)}
                    onClick={() => update({ ...settings, refMod: { ...settings.refMod, targetReference: index } })}
                  >
                    {reference.label || `Picture ${index + 1}`}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
