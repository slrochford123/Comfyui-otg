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

describe("H3 persistent mutually-exclusive selections", () => {
  it("retains exactly one selected mode", () => {
    render(<H3Panel />);
    const text = screen.getByRole("tab", { name: /Text/ });
    const image = screen.getByRole("tab", { name: /Image/ });
    const reference = screen.getByRole("tab", { name: /Reference/ });
    expect(text.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(image);
    expect(
      [text, image, reference].filter(
        (item) => item.getAttribute("aria-selected") === "true",
      ),
    ).toEqual([image]);
    fireEvent.click(reference);
    expect(
      [text, image, reference].filter(
        (item) => item.getAttribute("aria-selected") === "true",
      ),
    ).toEqual([reference]);
  });

  it("retains exactly one enhancement level without selecting action buttons", () => {
    render(<H3Panel />);
    const short = screen.getByRole("button", { name: "Enhance Short" });
    const medium = screen.getByRole("button", { name: "Enhance Medium" });
    const long = screen.getByRole("button", { name: "Enhance Long" });
    fireEvent.click(short);
    expect(short.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(medium);
    expect(short.getAttribute("aria-pressed")).toBe("false");
    expect(medium.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(long);
    expect(medium.getAttribute("aria-pressed")).toBe("false");
    expect(long.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Clear" })
        .hasAttribute("aria-pressed"),
    ).toBe(false);
    expect(
      screen
        .getByRole("button", { name: /Prompt Builder/ })
        .hasAttribute("aria-pressed"),
    ).toBe(false);
  });

  it("retains exactly one quality and duration", () => {
    render(<H3Panel />);
    const lq = screen.getByRole("button", { name: /LQ/ });
    const hq = screen.getByRole("button", { name: /HQ/ });
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
    const details = screen.getByText("Choose the Look").closest("details")!;
    fireEvent.click(screen.getByText("Choose the Look"));
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
