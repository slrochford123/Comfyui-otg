// @vitest-environment jsdom

import fs from "node:fs";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import H3LoraAdminPanel from "../../../app/app/components/H3LoraAdminPanel";
import H3Panel from "../../../app/app/components/H3Panel";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, entries: [], maxSelections: 3 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openLegacyManual() {

  const legacy = document.querySelector('[data-otg="h3-video-workspace"]') as HTMLElement;
  expect(legacy.hidden).toBe(false);
  return screen;
}

describe("H3 persistent mutually-exclusive selections", () => {
  it("keeps model/render and live speed after duration, outside the separate LoRA disclosure", () => {
    render(<H3Panel />);
    const ui = openLegacyManual();
    fireEvent.click(ui.getByRole("button", { name: "Reference",exact:true }));
    const quality = ui.getByRole("group", { name: "H3 quality" });
    const duration = ui.getByRole("group", { name: "H3 duration" });
    const model = ui.getByRole("group", { name: "H3 model" });
    const renderMode = ui.getByRole("group", { name: "H3 render mode" });
    const orientation = ui.getByRole("group", { name: "H3 orientation" });
    const speed = () => document.querySelector('[data-otg="h3-generation-speed"]')!;
    const loras = document.querySelector('[data-otg="h3-optional-loras"]') as HTMLDetailsElement;
    for(const control of [quality,duration,model,renderMode,orientation,speed()])expect(loras.contains(control)).toBe(false);
    for (const control of [model, renderMode, speed()]) expect(control.closest("details")).toBeNull();
    expect(loras.open).toBe(false);
    expect(within(loras).getByText("+ Add approved LoRA")).toBeTruthy();
    expect(loras.querySelector('[aria-label="H3 model"]')).toBeNull();
    expect(loras.querySelector('[aria-label="H3 render mode"]')).toBeNull();
    fireEvent.click(within(quality).getByRole("button", { name: "Enhanced", exact:true }));
    fireEvent.click(ui.getByRole("button", { name: "Native", exact: true }));
    expect(speed().getAttribute("data-speed")).toBe("slow");
    fireEvent.click(ui.getByRole("button", { name: "SelfLift", exact: true }));
    expect(speed().getAttribute("data-speed")).toBe("fast");
    expect(loras.open).toBe(false);
    fireEvent.change(ui.getByRole("combobox", { name: "Singularity version" }), { target: { value: "singularity" } });
    expect(ui.getByRole("button", { name: "Native", exact: true }).getAttribute("aria-pressed")).toBe("true");
    expect(ui.getByRole("checkbox", { name: /Combat LoRA/ })).toBeTruthy();
    expect(speed().getAttribute("data-speed")).toBe("slow");
    fireEvent.change(ui.getByRole("combobox", { name: "Singularity version" }), { target: { value: "singularity-v1.3" } });
    expect(ui.getByRole("combobox", { name: "Singularity version" }).getAttribute("data-selected")).toBe("true");
    expect(ui.getByText(/Singularity v1.3 · Realism On/)).toBeTruthy();
    expect(ui.getByRole("button", { name: "Native", exact: true }).getAttribute("aria-pressed")).toBe("true");
  });

  it("retains exactly one selected mode", () => {
    render(<H3Panel />);
    const screen = openLegacyManual();
    const text = screen.getByRole("button", { name: "Text",exact:true });
    const image = screen.getByRole("button", { name: "Image",exact:true });
    const reference = screen.getByRole("button", { name: "Reference",exact:true });
    expect(text.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(image);
    expect(
      [text, image, reference].filter(
        (item) => item.getAttribute("aria-pressed") === "true",
      ),
    ).toEqual([image]);
    fireEvent.click(reference);
    expect(
      [text, image, reference].filter(
        (item) => item.getAttribute("aria-pressed") === "true",
      ),
    ).toEqual([reference]);
  });

  it("offers three enhancement actions without changing the active generation method",()=>{render(<H3Panel/>);const ui=openLegacyManual();for(const name of ["Short","Medium","Long"]){expect(ui.getByRole("button",{name,exact:true})).toBeTruthy();}expect(ui.getByRole("button",{name:"Text",exact:true}).getAttribute("aria-pressed")).toBe("true");expect(ui.getByRole("button",{name:"Clear",exact:true}).hasAttribute("aria-pressed")).toBe(false);});

  it("retains exactly one quality and duration", () => {
    render(<H3Panel />);
    const screen = openLegacyManual();
    const lq = screen.getByRole("button", { name: "Normal",exact:true });
    const hq = screen.getByRole("button", { name: "Enhanced", exact:true });
    const five = screen.getByRole("button", { name: "5 sec" });
    const ten = screen.getByRole("button", { name: "10 sec" });
    fireEvent.click(hq);
    expect(lq.getAttribute("aria-pressed")).toBe("false");
    expect(hq.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(ten);
    expect(five.getAttribute("aria-pressed")).toBe("false");
    expect(ten.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("H3 simplified builder and destructive separation", () => {
  it("keeps only the three requested structured controls", () => {
    render(<H3Panel />);
    const screen = openLegacyManual();
    const details = screen.getByText("Choose the Look").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(details.open).toBe(true);
    expect(within(details).getAllByRole("combobox")).toHaveLength(3);
    expect(within(details).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(details).getByText("Visual Style")).toBeTruthy();
    expect(within(details).getByText("Camera Feel")).toBeTruthy();
    expect(within(details).getByText("Shot Flow")).toBeTruthy();
  });

  it("does not issue a delete request when the confirmation is canceled", async () => {
    const model = {
      id: "model",
      displayName: "Model",
      filename: "MiniMax-H3/model.safetensors",
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
    };
    const fetchMock = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Response(
          JSON.stringify({ ok: true, entries: [model], maxSelections: 3 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<H3LoraAdminPanel />);
    await screen.findByText("Model");
    fireEvent.click(screen.getByText("Model"));
    fireEvent.click(screen.getByRole("button", { name: "Delete File..." }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      fetchMock.mock.calls.some(([, init]) =>
        String(init?.body || "").includes("delete-file"),
      ),
    ).toBe(false);
  });

  it("keeps discovered identity server-owned and separates revoke from delete", () => {
    const route = fs.readFileSync("app/api/admin/h3-loras/route.ts", "utf8");
    expect(route).toContain("filename: existing.filename");
    expect(route).toContain('action === "revoke"');
    expect(route).toContain('action === "delete-file"');
  });
});
