"use client";

import React from "react";

type SeedLockMode = "consume" | "locked" | "cycle";
type RunState = "idle" | "running" | "complete" | "error";

type ComfyPreset = {
  name: string;
  label?: string;
  description?: string;
  img2img?: boolean;
};

type Props = {
  generationLocked: boolean;
  lockMessage: string;

  presets: ComfyPreset[];
  selectedPreset: string;
  setSelectedPreset: (v: string) => void;

  runName: string;
  setRunName: (v: string) => void;

  positivePrompt: string;
  setPositivePrompt: (v: string) => void;

  negativePrompt: string;
  setNegativePrompt: (v: string) => void;

  canRun: boolean;
  sending: boolean;
  status: string;

  generateNow: () => void | Promise<void>;
  resetNow?: () => void | Promise<void>;

  runState: RunState;
};

export function QueuePanel(props: Props) {
  const {
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
    resetNow,
    runState,
  } = props;

  const showReset = typeof resetNow === "function" && generationLocked;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Lock banner */}
      {generationLocked ? (
        <div
          className="otg-alert"
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 260px" }}>
            {lockMessage || "Locked. Please clear existing content to generate again."}
          </div>

          {showReset ? (
            <button
              type="button"
              className="otg-btn otg-btnGhost"
              onClick={() => resetNow?.()}
              title="Force unlock if the server thinks content is still active"
            >
              Reset / Unlock
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Main generator row */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {/* Workflow */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 700 }}>Workflow</div>
          <select
            className="otg-select"
            value={selectedPreset}
            onChange={(e) => setSelectedPreset(e.target.value)}
            disabled={sending || generationLocked}
            style={{ minWidth: 180 }}
          >
            {Array.isArray(presets) && presets.length ? (
              presets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.label ?? p.name}
                </option>
              ))
            ) : (
              <option value="">No workflows found</option>
            )}
          </select>
        </div>

        {/* Optional run name */}
        <input
          className="otg-input"
          value={runName}
          onChange={(e) => setRunName(e.target.value)}
          placeholder="Name (optional)"
          disabled={sending || generationLocked}
          style={{ width: 220 }}
        />

        {/* Generate button */}
        <button
          type="button"
          className="otg-btn otg-btnPrimary"
          onClick={() => generateNow()}
          disabled={!canRun || sending || generationLocked}
          title={
            generationLocked
              ? "Locked until you clear existing content in Gallery"
              : !canRun
              ? "Select workflow + enter prompt first"
              : "Generate"
          }
        >
          {sending || runState === "running" ? "Generating…" : "Generate"}
        </button>

        {/* Status text */}
        <div style={{ opacity: 0.8, marginLeft: 6 }}>
          {status || "Ready"}
        </div>
      </div>

      {/* Prompt inputs (keeps your UI behavior intact) */}
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 700 }}>Prompt</div>
          <textarea
            className="otg-textarea"
            value={positivePrompt}
            onChange={(e) => setPositivePrompt(e.target.value)}
            placeholder="Describe what you want…"
            rows={4}
            disabled={sending || generationLocked}
          />
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 700, opacity: 0.85 }}>Negative prompt (optional)</div>
          <textarea
            className="otg-textarea"
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="What to avoid…"
            rows={3}
            disabled={sending || generationLocked}
          />
        </div>
      </div>
    </div>
  );
}

// Optional default export too (harmless). Keeps compatibility if any other file uses default import.
export default QueuePanel;
