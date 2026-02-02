"use client";

import React from "react";
import type { GeneratorState } from "../../lib/generator/types";
import type { GeneratorAction } from "../../lib/generator/reducer";
import { VideoProfilePicker } from "./VideoProfilePicker";
import { DurationPicker } from "./DurationPicker";
import { EnhancePanel } from "./EnhancePanel";

export function GeneratorScreen(props: {
  state: GeneratorState;
  dispatch: React.Dispatch<GeneratorAction>;
}) {
  const { state, dispatch } = props;

  return (
    <div className="otg-stack" style={{ padding: 16, maxWidth: 520, margin: "0 auto" }}>
      <div className="otg-card">
        <div className="otg-cardTitle">Prompts</div>

        <div className="otg-cardSubtitle">Positive</div>
        <textarea
          className="otg-textarea"
          value={state.prompt}
          placeholder="Describe what you want..."
          onChange={(e) => dispatch({ type: "setPrompt", prompt: e.target.value })}
        />

        <div className="otg-cardSubtitle" style={{ marginTop: 10 }}>
          Negative (optional)
        </div>
        <textarea
          className="otg-textarea"
          value={state.negative}
          placeholder="Things you don't want... (optional)"
          onChange={(e) => dispatch({ type: "setNegative", negative: e.target.value })}
        />
      </div>      <EnhancePanel
        level={state.enhanceLevel}
        onChangeLevel={(v) => dispatch({ type: "setEnhanceLevel", enhanceLevel: v })}
        onEnhance={() => {
          // Wire to /api/enhance in GeneratorApp; Storybook keeps this local.
          // eslint-disable-next-line no-console
          console.log("Enhance clicked:", state.enhanceLevel);
        }}
      />



      <VideoProfilePicker
        ratio={state.ratio}
        size={state.size}
        onChangeRatio={(ratio) => dispatch({ type: "setRatio", ratio })}
        onChangeSize={(size) => dispatch({ type: "setSize", size })}
      />

      <DurationPicker
        value={state.seconds}
        onChange={(seconds) => dispatch({ type: "setSeconds", seconds })}
      />

      <div className="otg-card">
        <div className="otg-cardTitle">Generate</div>
        <button className="otg-btn otg-btnPrimary" type="button">
          Generate
        </button>
        <div className="otg-muted" style={{ marginTop: 8 }}>
          Storybook screen scaffold. Wire this to /api/comfy once the UI is locked.
        </div>
      </div>
    </div>
  );
}
