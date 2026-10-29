"use client";

import React from "react";
import { isH3SingularityMode, type H3CheckpointMode, type H3SingularityMode } from "@/lib/production/h3Settings";

/** One native dropdown, rather than two additional model tiles. */
export default function H3SingularitySelector({ value, onChange, disabled, className }: {
  value: H3CheckpointMode;
  onChange: (mode: H3SingularityMode) => void;
  disabled?: boolean;
  className?: string;
}) {
  const active = isH3SingularityMode(value);
  return (
    <select
      aria-label="Singularity version"
      title="Choose Singularity v1.3 or v2. Both retain Native/Turbo, automatic Realism and optional Combat."
      value={active ? value : ""}
      disabled={disabled}
      className={`w-full min-w-0 cursor-pointer ${className || ""}`}
      data-otg="h3-singularity-version"
      data-selected={active ? "true" : "false"}
      onChange={event => {
        if (isH3SingularityMode(event.target.value)) onChange(event.target.value);
      }}
    >
      <option value="" disabled>Singularity</option>
      <option value="singularity-v1.3" className="bg-zinc-950 text-white">Singularity 1.3</option>
      <option value="singularity" className="bg-zinc-950 text-white">Singularity 2</option>
    </select>
  );
}
