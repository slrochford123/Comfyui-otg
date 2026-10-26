// @vitest-environment jsdom
import React, { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import H3AdvancedControls from "@/app/app/components/H3AdvancedControls";
import { DEFAULT_H3_ADVANCED_SETTINGS, type H3RenderMode } from "@/lib/production/h3Settings";
afterEach(cleanup);
describe("independent legacy and FastH3 controls", () => {
  it.each(["native", "turbo"] as H3RenderMode[])("preserves %s when switching to FastH3 and back", renderMode => {
    function Harness() {
      const [value, setValue] = useState({ ...DEFAULT_H3_ADVANCED_SETTINGS, renderMode });
      return <H3AdvancedControls value={value} onChange={setValue} allowFastH3 referenceOptions={[{ label: "Dragon" }]} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Singularity", exact: true }));
    expect(screen.getByRole("checkbox", { name: /Combat LoRA/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "FastH3", exact: true }));
    expect(screen.getByText(/FastH3 · 8 Steps · Euler · VSA/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Native", exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RefMod", exact: true })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Motion", exact: true })).toBeDisabled();
    expect(screen.queryByRole("checkbox", { name: /Combat LoRA/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Singularity", exact: true }));
    expect(screen.getByRole("button", { name: renderMode === "native" ? "Native" : "Turbo", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: /Combat LoRA/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Standard", exact: true }));
    expect(screen.getByRole("button", { name: renderMode === "native" ? "Native" : "Turbo", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
  it("preserves other workflows' existing Native/Singularity controls", () => {
    render(<H3AdvancedControls value={DEFAULT_H3_ADVANCED_SETTINGS} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Native", exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Singularity", exact: true })).toBeVisible();
    expect(screen.queryByRole("button", { name: "FastH3", exact: true })).not.toBeInTheDocument();
  });
  it("requires explicitly removing incompatible optional LoRAs before FastH3 selection", () => {
    const onChange = vi.fn();
    render(<H3AdvancedControls value={DEFAULT_H3_ADVANCED_SETTINGS} onChange={onChange} allowFastH3 fastH3BlockedReason="Remove selected optional LoRAs first" />);
    fireEvent.click(screen.getByRole("button", { name: "FastH3", exact: true }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Remove selected optional LoRAs first");
  });
});
