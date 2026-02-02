"use client";

import React from "react";
import { Chip } from "../ui/Chip";
import type { Seconds } from "../../lib/generator/types";

export function DurationPicker({
  value,
  onChange,
}: {
  value: Seconds;
  onChange: (v: Seconds) => void;
}) {
  const options: Seconds[] = [5, 7, 10];

  return (
    <section className="otg-card">
      <div className="otg-cardTitle">Seconds</div>
      <div className="otg-row otg-wrap" style={{ gap: 10 }}>
        {options.map((s) => (
          <Chip key={s} active={value === s} onClick={() => onChange(s)}>
            {s}s
          </Chip>
        ))}
      </div>
    </section>
  );
}
