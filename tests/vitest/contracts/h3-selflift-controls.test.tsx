// @vitest-environment jsdom
import React, { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import H3AdvancedControls from "@/app/app/components/H3AdvancedControls";
import { DEFAULT_H3_ADVANCED_SETTINGS, type H3RenderMode } from "@/lib/production/h3Settings";
afterEach(cleanup);
describe("SelfLift is an additive mobile-friendly selection", () => {
  it.each(["native", "turbo"] as H3RenderMode[])("retains %s through SelfLift/FastH3 and back", renderMode => {
    function Harness() {
      const [value, setValue] = useState({ ...DEFAULT_H3_ADVANCED_SETTINGS, renderMode });
      return <H3AdvancedControls value={value} onChange={setValue} allowFastH3 />;
    }
    render(<Harness />);
    expect(screen.getByRole("group", { name: "H3 model" })).toHaveClass("grid-cols-2");
    for (const name of ["Standard", "Singularity", "FastH3", "SelfLift"]) expect(screen.getByRole("button", { name, exact: true })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "SelfLift", exact: true }));
    expect(screen.getByRole("button", { name: "SelfLift", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/SelfLift · 8 Steps · 6 low \+ 2 full resolution/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Native", exact: true })).toBeNull();
    expect(screen.getByRole("button", { name: "Motion", exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "FastH3", exact: true }));
    expect(screen.getByRole("button", { name: "SelfLift", exact: true })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Singularity", exact: true }));
    expect(screen.getByRole("button", { name: renderMode === "native" ? "Native" : "Turbo", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: /Combat LoRA/ })).toBeChecked();
  });
  it("does not expose the R2V-only SelfLift choice in unrelated tools", () => {
    render(<H3AdvancedControls value={DEFAULT_H3_ADVANCED_SETTINGS} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "SelfLift", exact: true })).toBeNull();
  });
});
