"use client";

import React from "react";

type Preset = { name: string; label?: string; description?: string; img2img?: boolean };

type RunState = "idle" | "running" | "complete" | "error" | string;

export function QueuePanel(props: {
  /** Click to re-fetch workflows from the server (no restart). */
  refreshWorkflows?: () => void;

  generationLocked: boolean;
  lockMessage?: string | null;

  presets: Preset[];
  selectedPreset: string;
  setSelectedPreset: (v: string) => void;

  /** Optional name/title for this run (kept client-side unless you wire it into history). */
  runName: string;
  setRunName: (v: string) => void;

  positivePrompt: string;
  setPositivePrompt: (v: string) => void;

  negativePrompt: string;
  setNegativePrompt: (v: string) => void;

  canRun: boolean;
  sending: boolean;
  status: string;
  generateNow: () => Promise<void> | void;

  runState: RunState;
}) {
  const {
    refreshWorkflows,
    generationLocked,
    lockMessage,
    presets,
    selectedPreset,
    setSelectedPreset,
    runName,
    setRunName,
    positivePrompt,
    setPositivePrompt,
    negativePrompt,
    setNegativePrompt,
    canRun,
    sending,
    status,
    generateNow,
    runState,
  } = props;

  const disabled = sending || generationLocked;

  return (
    <div className="space-y-4">
      {/* Lock banner */}
      {generationLocked && (lockMessage ?? "").trim() !== "" ? (
        <div className="otg-alert otg-alertWarn">
          <div className="otg-alertTitle">Generation Locked</div>
          <div className="otg-alertBody">{lockMessage}</div>
        </div>
      ) : null}

      {/* Workflow */}
      <section className="otg-card">
        <div className="otg-cardInner space-y-2">
          <div className="otg-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div className="otg-cardTitle">Select Workflow</div>
            <button
              type="button"
              className="otg-btn otg-btnGhost"
              onClick={() => refreshWorkflows?.()}
              disabled={disabled}
              title="Reload workflows without restarting"
            >
              Sync Workflows
            </button>
          </div>

          <select
            className="otg-select"
            value={selectedPreset}
            onChange={(e) => setSelectedPreset(e.target.value)}
            disabled={disabled}
          >
            {presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.label || p.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Optional name */}
      <section className="otg-card">
        <div className="otg-cardInner space-y-2">
          <div className="otg-cardTitle">Name (optional)</div>
          <input
            className="otg-input"
            value={runName}
            onChange={(e) => setRunName(e.target.value)}
            placeholder="e.g. 'Blue cyberpunk portrait'"
            disabled={disabled}
          />
        </div>
      </section>

      {/* Prompts */}
      <section className="otg-card">
        <div className="otg-cardInner space-y-3">
          <div className="otg-cardTitle">Prompts</div>

          <div className="space-y-1">
            <label className="otg-label">Positive</label>
            <textarea
              className="otg-textarea"
              value={positivePrompt}
              onChange={(e) => setPositivePrompt(e.target.value)}
              placeholder="Describe what you want…"
              rows={6}
              disabled={disabled}
            />
          </div>

          <div className="space-y-1">
            <label className="otg-label">Negative (optional)</label>
            <textarea
              className="otg-textarea"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="Things you don’t want… (optional)"
              rows={3}
              disabled={disabled}
            />
          </div>
        </div>
      </section>

      {/* Generate */}
      <section className="otg-card">
        <div className="otg-cardInner space-y-3">
          <div className="otg-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div className="otg-cardTitle">Generate</div>
            <div className="otg-help">
              State: <span className="font-mono text-white/80">{String(runState)}</span>
            </div>
          </div>

          <button
            type="button"
            className="otg-btn otg-btnPrimary w-full"
            onClick={() => generateNow()}
            disabled={disabled || !canRun}
          >
            {sending ? "Generating…" : "Generate"}
          </button>

          <div className="otg-help">{status}</div>
        </div>
      </section>
    </div>
  );
}
