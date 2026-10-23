// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import H3Panel from "@/app/app/components/H3Panel";
const json = (value: unknown) => new Response(JSON.stringify(value));
beforeEach(() => {
  localStorage.clear();
  const NativeURL = URL;
  vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL: vi.fn(() => "blob:source"), revokeObjectURL: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true, catalog: [], entries: [], maxSelections: 3 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Phase 3 parent integration", () => {
  it("hides the entire legacy studio in Auto and retains its controls and input values in Manual", async () => {
    const view = render(<H3Panel authenticatedOwnerKey="qa" />);
    expect(screen.getByRole("button", { name: "Auto Mode" })).toHaveAttribute("aria-pressed", "true");
    const legacy = view.container.querySelector('[data-otg="h3-legacy-manual-tools"]')!;
    expect(legacy).toHaveAttribute("hidden"); expect(screen.queryByRole("tab", { name: /Text/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset H3 Generator" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manual Mode" })); expect(legacy).not.toHaveAttribute("hidden");
    expect(screen.getByRole("tab", { name: /Text/ })).toBeInTheDocument(); expect(screen.getByRole("tab", { name: /Realism/ })).toBeInTheDocument();
    const original = screen.getByPlaceholderText("Describe the scene, action, camera, dialogue, and sound.");
    fireEvent.change(original, { target: { value: "Preserve the legacy scene" } });
    fireEvent.click(screen.getByRole("button", { name: "Auto Mode" })); expect(legacy).toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Manual Mode" })); expect(original).toHaveValue("Preserve the legacy scene");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });
  it("opens the original menu first, then complete Manual controls beside Edit Video, without losing drafts", async () => {
    const view = render(<H3Panel authenticatedOwnerKey="qa" />);
    const description = screen.getByLabelText("Video description");
    fireEvent.change(description, { target: { value: "Keep my Studio draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Manual Mode" }));
    expect(screen.getByRole("heading", { name: "H3 Studio" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Workflow" })).not.toBeInTheDocument();
    expect(description).not.toBeVisible();
    const edit = screen.getByRole("button", { name: /^Edit Video/ });
    const manual = screen.getByRole("button", { name: /^Manual Complete creative controls$/ });
    expect(edit.nextElementSibling).toBe(manual);
    expect(manual.parentElement?.children).toHaveLength(8);
    fireEvent.click(manual);
    expect(screen.getByRole("combobox", { name: "Workflow" })).toBeVisible();
    expect(description).toHaveValue("Keep my Studio draft");
    expect(screen.queryByRole("heading", { name: "H3 Studio" })).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-otg="h3-legacy-manual-tools"]')).toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Back to H3 Studio" }));
    expect(screen.getByRole("heading", { name: "H3 Studio" })).toBeVisible();
    expect(description).toHaveValue("Keep my Studio draft");
    fireEvent.click(manual);
    fireEvent.click(screen.getByRole("button", { name: "Manual Mode" }));
    expect(screen.getByRole("heading", { name: "H3 Studio" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Auto Mode" }));
    expect(description).toBeVisible();
    expect(description).toHaveValue("Keep my Studio draft");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });
  it("opens Manual editing from Auto's submitted settings without another generation", async () => {
    const server = vi.fn(async (url, init) => {
      if (url === "/api/h3/studio/auto") return json({ plan: JSON.parse(init!.body as string).plan, job: { id: "job", status: "completed", statusMessage: "Video complete", galleryStatus: "saved" }, settings: { manifest: { steps: 8 }, estimate: { explanation: "Owner experimental" } } });
      return json({ ok: true, catalog: [] });
    }); vi.stubGlobal("fetch", server);
    render(<H3Panel authenticatedOwnerKey="qa" />);
    fireEvent.change(screen.getByLabelText("Video description"), { target: { value: "Keep this scene" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Video" }));
    (await screen.findByText("Video settings")).closest("details")!.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Edit Plan in Manual" }));
    expect(screen.getByRole("combobox", { name: "Workflow" })).toBeVisible();
    expect(screen.getByLabelText("Video description")).toHaveValue("Keep this scene");
    expect(screen.getByRole("button", { name: "Back to H3 Studio" })).toBeVisible();
    expect(server.mock.calls.filter(([url]) => url === "/api/h3/studio/auto")).toHaveLength(1);
  });
  it("keeps active-job controls and cancellation errors visible on the original Studio menu", async () => {
    localStorage.setItem("otg:h3:studio-history:v1:qa", JSON.stringify([{ id: "active-job", status: "running", statusMessage: "Rendering video" }]));
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      if (String(input).startsWith("/api/h3/generation?")) return json({ ok: true, job: { id: "active-job", status: "running", statusMessage: "Rendering video" } });
      if (String(input) === "/api/h3/generation" && init?.method === "POST") return json({ ok: false, error: "Cannot safely interrupt this worker." });
      return json({ ok: true, catalog: [] });
    }));
    render(<H3Panel authenticatedOwnerKey="qa" />);
    await screen.findByRole("button", { name: "Safe Cancel" });
    fireEvent.click(screen.getByRole("button", { name: "Manual Mode" }));
    expect(screen.getByRole("heading", { name: "H3 Studio" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Safe Cancel" }));
    expect(await screen.findByText("Cannot safely interrupt this worker.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Rendering video" })).toBeVisible();
  });
  it("keeps Edit Video inside Manual with all eight original choices preserved", async () => {
    render(<H3Panel authenticatedOwnerKey="qa" />);
    fireEvent.click(screen.getByRole("button", { name: "Manual Mode" }));
    expect(screen.getByRole("button", { name: /^Manual Complete creative controls$/ }).parentElement?.children).toHaveLength(8);
    expect(screen.getByRole("tab", { name: /Ref Mods/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Edit Video/ }));
    expect(screen.getByLabelText("Megapixel size")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Auto Mode" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Manual Mode" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Create Video" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Back to H3 Studio" }));
    expect(screen.getByRole("tab", { name: /Ref Mods/ })).toBeVisible();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });
});
