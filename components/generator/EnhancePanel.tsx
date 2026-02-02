"use client";

import React from "react";
import { Chip } from "../ui/Chip";
import type { EnhanceLevel } from "../../lib/generator/types";

export function EnhancePanel(props: {
  level: EnhanceLevel;
  onChangeLevel: (v: EnhanceLevel) => void;
  onEnhance: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const { level, onChangeLevel, onEnhance, disabled, busy } = props;

  const levels: { id: EnhanceLevel; label: string; help: string }[] = [
    { id: "small", label: "Small", help: "Light cleanup + small clarity boost" },
    { id: "medium", label: "Medium", help: "Adds detail (lighting, camera, style)" },
    { id: "large", label: "Large", help: "Cinematic rewrite (stronger composition)" },
  ];

  return (
    <div className="otg-card">
      <div className="otg-cardTitle">Enhance Prompt</div>
      <div className="otg-cardSubtitle">Strength</div>

      <div className="otg-row otg-wrap">
        {levels.map((l) => (
          <Chip
            key={l.id}
            active={level === l.id}
            disabled={disabled || busy}
            onClick={() => onChangeLevel(l.id)}
          >
            {l.label}
          </Chip>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="otg-btn otg-btnPrimary"
          disabled={disabled || busy}
          onClick={onEnhance}
        >
          {busy ? "Enhancing..." : "Enhance"}
        </button>
      </div>

      <div className="otg-muted" style={{ marginTop: 8 }}>
        {levels.find((x) => x.id === level)?.help}
      </div>
    </div>
  );
}
