// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import H3StudioControls from "@/app/app/components/H3StudioControls";
beforeEach(() => { localStorage.clear(); vi.stubGlobal("fetch", vi.fn(async (_url, options) => new Response(JSON.stringify(options?.method ? { ok: true, review: { id: "review", mediaFingerprint: "media" }, manifest: { executable: false, blockedReasons: ["UPSTREAM_RIGHTS_AUTHORIZATION_REQUIRED"], steps: 20, sampler: "res_multistep" }, graph: {}, estimate: { explanation: "No generation submitted" } } : { ok: true, catalog: [] })))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("H3 mobile Auto/Manual controllers", () => {
  it("defaults to Auto and does not call a paid planner or generation endpoint", () => {
    render(<H3StudioControls ownerKey="qa" />);
    expect(screen.getByRole("button", { name: "Auto Mode" }).getAttribute("aria-pressed")).toBe("true");
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledWith("/api/h3/studio", expect.not.objectContaining({ method: "POST" }));
  });
  it("retains intent/settings when switching controllers", () => {
    render(<H3StudioControls ownerKey="qa" />);
    fireEvent.change(screen.getByLabelText("Video description"), { target: { value: "A red test kite" } });
    fireEvent.click(screen.getByRole("button", { name: "Manual Mode" }));
    expect((screen.getByLabelText("Video description") as HTMLTextAreaElement).value).toBe("A red test kite");
    expect(screen.getByLabelText("Seed")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Auto Mode" }));
    expect((screen.getByLabelText("Video description") as HTMLTextAreaElement).value).toBe("A red test kite");
  });
  it("keeps reviewed execution and Manual inspection separate from one-click Auto", async () => {
    render(<H3StudioControls ownerKey="qa" />);
    fireEvent.change(screen.getByLabelText("Video description"), { target: { value: "A red kite" } });
    fireEvent.click(screen.getByRole("button", { name: "Manual Mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview Video Plan (no cost)" }));
    await waitFor(() => expect(screen.getByText("UPSTREAM_RIGHTS_AUTHORIZATION_REQUIRED")).toBeDefined());
    expect(screen.getByRole("button", { name: "Generate reviewed video" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit Plan in Manual" }));
    expect(screen.getByLabelText("Workflow")).toBeDefined();
  });
  it("isolates named presets by account and does not store media files", () => {
    const view = render(<H3StudioControls ownerKey="ownerA" />);
    fireEvent.change(screen.getByLabelText("Video description"), { target: { value: "QA landscape" } }); fireEvent.click(screen.getByRole("button", { name: "Manual Mode" }));
    fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: "QA preset" } }); fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
    expect(localStorage.getItem("otg:h3:studio-presets:v1:ownerA")).toContain("QA preset");
    view.rerender(<H3StudioControls ownerKey="ownerB" />);
    expect(screen.queryByRole("button", { name: "Load QA preset" })).toBeNull();
  });
});
