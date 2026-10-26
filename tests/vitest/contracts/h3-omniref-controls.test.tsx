// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import H3AdvancedControls from "@/app/app/components/H3AdvancedControls";
import { DEFAULT_H3_ADVANCED_SETTINGS } from "@/lib/production/h3Settings";
afterEach(cleanup);
describe("truthful selected reference profile controls", () => {
  it("does not advertise the ignored Native/Singularity alternatives for OmniRef", () => {
    render(<H3AdvancedControls value={DEFAULT_H3_ADVANCED_SETTINGS} onChange={vi.fn()} fixedReferenceProfile />);
    expect(screen.getByText(/FastH3 OmniRef/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Native", exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Singularity", exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RefMod", exact: true })).toBeVisible();
  });
  it("preserves other workflows' existing Native/Singularity controls", () => {
    render(<H3AdvancedControls value={DEFAULT_H3_ADVANCED_SETTINGS} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Native", exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Singularity", exact: true })).toBeVisible();
  });
});
