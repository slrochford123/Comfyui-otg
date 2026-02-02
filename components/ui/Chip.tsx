"use client";

import React from "react";

export type ChipProps = {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
};

export function Chip({ active, onClick, children, disabled, className }: ChipProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "otg-btn",
        "otg-btnChip",
        active ? "otg-btnChipActive" : "",
        className || "",
      ].join(" ").trim()}
    >
      {children}
    </button>
  );
}
