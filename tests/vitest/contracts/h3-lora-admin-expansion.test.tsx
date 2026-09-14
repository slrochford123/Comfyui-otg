// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import H3LoraAdminPanel from "../../../app/app/components/H3LoraAdminPanel";
import type { H3LoraCatalogEntry } from "../../../lib/h3LoraCatalogServer";

function model(
  id: string,
  patch: Partial<H3LoraCatalogEntry> = {},
): H3LoraCatalogEntry {
  return {
    id,
    displayName: `Model ${id.toUpperCase()}`,
    filename: `MiniMax-H3/model-${id}.safetensors`,
    description: "",
    enabled: false,
    approvedForH3: false,
    approvedForT2V: false,
    approvedForI2V: false,
    approvedForR2V: false,
    defaultStrength: 1,
    minStrength: 0,
    maxStrength: 1.2,
    recommendedMin: 0.5,
    recommendedMax: 1,
    triggerWords: [],
    triggerRequired: false,
    previewImage: "",
    notes: "",
    discoveredOn: ["rtx3090"],
    missingOn: ["rtx5060ti"],
    compatibilityStatus: "review",
    ...patch,
  };
}

function response(entries: H3LoraCatalogEntry[]) {
  return new Response(
    JSON.stringify({
      ok: true,
      entries,
      maxSelections: 3,
      backends: [],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function mockCatalog(
  initial: H3LoraCatalogEntry[],
  refreshed: H3LoraCatalogEntry[] = initial,
) {
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) =>
    response(init?.method === "POST" ? refreshed : initial),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function card(name: string) {
  return screen.getByText(name).closest("details") as HTMLDetailsElement;
}

async function expand(name: string) {
  await screen.findByText(name);
  fireEvent.click(screen.getByText(name));
  expect(card(name).open).toBe(true);
}

async function sync() {
  fireEvent.click(screen.getByRole("button", { name: "Sync Backends" }));
  await waitFor(() =>
    expect(
      screen.getByText("Discovered the H3 backend inventory."),
    ).toBeTruthy(),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("H3 LoRA admin expansion ownership", () => {
  it("remains expanded across the parent three-second polling rerender", async () => {
    mockCatalog([model("a")]);
    const { rerender } = render(
      <div data-poll-tick="0">
        <H3LoraAdminPanel />
      </div>,
    );
    await expand("Model A");

    rerender(
      <div data-poll-tick="3000">
        <H3LoraAdminPanel />
      </div>,
    );

    expect(card("Model A").open).toBe(true);
  });

  it("remains expanded when backend availability changes", async () => {
    mockCatalog(
      [model("a")],
      [
        model("a", {
          discoveredOn: ["rtx5060ti", "rtx3090"],
          missingOn: [],
        }),
      ],
    );
    render(<H3LoraAdminPanel />);
    await expand("Model A");
    await sync();

    expect(card("Model A").open).toBe(true);
    expect(card("Model A").textContent).toContain("RTX 5060 Ti: Installed");
  });

  it("remains expanded when catalog object identities change", async () => {
    const initial = model("a");
    mockCatalog([initial], [{ ...initial, triggerWords: [] }]);
    render(<H3LoraAdminPanel />);
    await expand("Model A");
    await sync();

    expect(card("Model A").open).toBe(true);
  });

  it("remains expanded when an unrelated LoRA is added", async () => {
    mockCatalog([model("a")], [model("a"), model("b")]);
    render(<H3LoraAdminPanel />);
    await expand("Model A");
    await sync();

    expect(card("Model A").open).toBe(true);
    expect(screen.getByText("Model B")).toBeTruthy();
  });

  it("collapses safely when the selected LoRA leaves inventory", async () => {
    mockCatalog([model("a"), model("b")], [model("b")]);
    render(<H3LoraAdminPanel />);
    await expand("Model A");
    await sync();

    expect(screen.queryByText("Model A")).toBeNull();
    expect(card("Model B").open).toBe(false);
  });

  it("preserves unsaved form edits during a catalog refresh", async () => {
    mockCatalog([model("a")], [model("a", { description: "Server update" })]);
    render(<H3LoraAdminPanel />);
    await expand("Model A");
    const displayName = screen.getByLabelText("Display Name");
    fireEvent.change(displayName, { target: { value: "Unsaved Name" } });
    await sync();

    expect(card("Unsaved Name").open).toBe(true);
    expect(
      (screen.getByLabelText("Display Name") as HTMLInputElement).value,
    ).toBe("Unsaved Name");
    expect(
      (screen.getByLabelText("Description") as HTMLTextAreaElement).value,
    ).toBe("Server update");
  });

  it("collapses when the expanded LoRA is clicked again", async () => {
    mockCatalog([model("a")]);
    render(<H3LoraAdminPanel />);
    await expand("Model A");
    fireEvent.click(screen.getByText("Model A"));

    expect(card("Model A").open).toBe(false);
  });

  it("uses accordion behavior when another LoRA is expanded", async () => {
    mockCatalog([model("a"), model("b")]);
    render(<H3LoraAdminPanel />);
    await expand("Model A");
    fireEvent.click(screen.getByText("Model B"));

    expect(card("Model A").open).toBe(false);
    expect(card("Model B").open).toBe(true);
  });
});
