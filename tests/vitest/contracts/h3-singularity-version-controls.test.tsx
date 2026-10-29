// @vitest-environment jsdom
import React, { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import H3AdvancedControls from "@/app/app/components/H3AdvancedControls";
import { DEFAULT_H3_ADVANCED_SETTINGS, type H3RenderMode } from "@/lib/production/h3Settings";
afterEach(cleanup);
describe("compact Singularity version dropdown", () => {
  it.each(["native", "turbo"] as H3RenderMode[])("keeps %s, Combat and enhancement choices while switching versions", renderMode => {
    function Harness() {
      const [value, onChange] = useState({ ...DEFAULT_H3_ADVANCED_SETTINGS, renderMode });
      return <H3AdvancedControls value={value} onChange={onChange} allowFastH3 referenceOptions={[{ label: "Person" }]} />;
    }
    render(<Harness />);
    const group = screen.getByRole("group", { name: "H3 model" });
    const selector = within(group).getByRole("combobox", { name: "Singularity version" });
    expect(group.closest("details")).toBeNull();
    expect(within(group).getAllByRole("button")).toHaveLength(3); // Standard, FastH3, SelfLift; no extra version tiles.
    expect(selector).toHaveValue("");
    fireEvent.change(selector, { target: { value: "singularity-v1.3" } });
    expect(selector).toHaveValue("singularity-v1.3");
    fireEvent.click(screen.getByRole("checkbox", { name: /Combat LoRA/ }));
    fireEvent.click(screen.getByRole("button", { name: "Motion", exact: true }));
    fireEvent.change(selector, { target: { value: "singularity" } });
    expect(selector).toHaveValue("singularity");
    expect(screen.getByRole("checkbox", { name: /Combat LoRA/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Motion", exact: true })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(selector, { target: { value: "singularity-v1.3" } });
    expect(screen.getByRole("button", { name: renderMode === "native" ? "Native" : "Turbo", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: /Combat LoRA/ })).not.toBeChecked();
  });
  it("disables the version chooser during a generation", () => {
    const onChange=vi.fn();
    render(<H3AdvancedControls value={DEFAULT_H3_ADVANCED_SETTINGS} onChange={onChange} disabled />);
    expect(screen.getByRole("combobox", { name: "Singularity version" })).toBeDisabled();
  });
});
