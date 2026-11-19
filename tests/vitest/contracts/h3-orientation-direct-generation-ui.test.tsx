// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import H3Panel from "../../../app/app/components/H3Panel";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ ok: true, entries: [], maxSelections: 3 }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )));
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:h3-test"),
    revokeObjectURL: vi.fn(),
  });
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

function writePrompt() {
  const legacy = document.querySelector('[data-otg="h3-video-workspace"]') as HTMLElement;
  fireEvent.change(
    within(legacy).getByPlaceholderText("Describe the scene, action, camera, dialogue, and sound."),
    { target: { value: "Two samurai fight in moonlight." } },
  );
}

describe("H3 orientation and optional Builder UI", () => {
  it("defaults to one landscape selection and retains portrait across modes", () => {
    render(<H3Panel />);
    const screen = openLegacyManual();
    const landscape = screen.getByRole("button", { name: "Landscape" });
    const portrait = screen.getByRole("button", { name: "Portrait" });

    expect(landscape.getAttribute("aria-pressed")).toBe("true");
    expect(portrait.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(portrait);
    expect(landscape.getAttribute("aria-pressed")).toBe("false");
    expect(portrait.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Image",exact:true }));
    fireEvent.click(screen.getByRole("button", { name: "Reference",exact:true }));
    expect(portrait.getAttribute("aria-pressed")).toBe("true");
  });

  it("enables direct T2V from raw text without Enhance or Prompt Builder", () => {
    render(<H3Panel />);
    const screen = openLegacyManual();
    expect(screen.getByRole("button", { name: /Add Prompt and Required Inputs/ }).hasAttribute("disabled")).toBe(true);
    writePrompt();
    expect(screen.getByRole("button", { name: "Generate Video" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Direct Scene",exact:true })).toBeTruthy();
  });

  it("submits raw text and orientation without calling Ollama", async () => {
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      const [input] = args;
      const url = String(input);
      if (url.startsWith("/api/h3/loras")) {
        return new Response(JSON.stringify({ ok: true, entries: [], maxSelections: 3 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        ok: true,
        job: {
          id: "direct-contract",
          status: "completed",
          statusMessage: "Video complete",
          mode: "h3-text-to-video",
          quality: "lq",
          orientation: "portrait",
          durationSeconds: 5,
          prompt: "Two samurai fight in moonlight.",
          backend: "rtx5060ti",
          backendLabel: "RTX 5060 Ti",
          workflowId: "workflow",
          workflowFile: "workflow.json",
          nativeResolution: "608x1056",
          etaSeconds: 1,
          etaMinSeconds: 1,
          etaMaxSeconds: 1,
          promptId: "prompt",
          queueRemaining: 0,
          progressPercent: 100,
          currentNode: null,
          error: null,
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          videoUrl: null,
        },
      }), { status: 202, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<H3Panel />);
    const screen = openLegacyManual();
    writePrompt();
    fireEvent.click(screen.getByRole("button", { name: "Portrait" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate Video" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/h3/generation")).toBe(true);
    });
    const generationCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/h3/generation" &&
        init?.method === "POST",
    );

    expect(generationCall).toBeTruthy();

    const generationBody = generationCall?.[1]?.body;
    expect(typeof generationBody).toBe("string");
    expect(generationCall?.[1]?.headers).toMatchObject({"X-H3-Request-Id": expect.any(String)});

    const config = JSON.parse(
      String(generationBody),
    ).config;
    expect(config).toMatchObject({
      prompt: "Two samurai fight in moonlight.",
      orientation: "portrait",
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/h3/prompt")).toBe(false);
  });

  it("keeps scene direction optional while preserving the raw scene",()=>{render(<H3Panel/>);const ui=openLegacyManual();writePrompt();const scene=ui.getByRole("textbox",{name:"Scene description"});expect(ui.getByRole("button",{name:"Direct Scene",exact:true})).toBeTruthy();expect(scene).toHaveProperty("value","Two samurai fight in moonlight.");expect(ui.getByRole("button",{name:"Generate Video",exact:true})).toHaveProperty("disabled",false);});

  it("enables direct I2V only after a First Image is present", () => {
    render(<H3Panel />);
    const screen = openLegacyManual();
    fireEvent.click(screen.getByRole("button", { name: "Image",exact:true }));
    writePrompt();
    expect(screen.getByRole("button", { name: /Add Prompt and Required Inputs/ }).hasAttribute("disabled")).toBe(true);
    const upload = document.querySelector('[data-otg="h3-video-workspace"] input[type="file"][accept^="image/*"]') as HTMLInputElement;
    fireEvent.change(upload, {
      target: { files: [new File(["image"], "first.png", { type: "image/png" })] },
    });
    expect(screen.getByRole("button", { name: "Generate Video" }).hasAttribute("disabled")).toBe(false);
  });

  it("enables direct R2V only after a native reference is present", () => {
    render(<H3Panel />);
    const screen = openLegacyManual();
    fireEvent.click(screen.getByRole("button", { name: "Reference",exact:true }));
    writePrompt();
    expect(screen.getByRole("button", { name: /Add Prompt and Required Inputs/ }).hasAttribute("disabled")).toBe(true);
    const upload = document.querySelector('[data-otg="h3-video-workspace"] input[type="file"][accept^="image/*"]') as HTMLInputElement;
    fireEvent.change(upload, {
      target: { files: [new File(["image"], "hero.png", { type: "image/png" })] },
    });
    expect(screen.getByRole("button", { name: "Generate Video" }).hasAttribute("disabled")).toBe(false);
  });

  it("persists H3 prompt and controls until the user resets the generator", async () => {
    render(<H3Panel authenticatedOwnerKey="persist-contract" />);
    let screen = openLegacyManual();
    writePrompt();
    fireEvent.click(screen.getByRole("button", { name: "Portrait" }));
    fireEvent.click(screen.getByRole("button", { name: "10 sec" }));

    await waitFor(() => {
      expect(window.localStorage.length).toBeGreaterThan(0);
    });

    cleanup();
    render(<H3Panel authenticatedOwnerKey="persist-contract" />);
    screen = openLegacyManual();

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Describe the scene, action, camera, dialogue, and sound."),
      ).toHaveProperty("value", "Two samurai fight in moonlight.");
    });

    expect(screen.getByRole("button", { name: "Portrait" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "10 sec" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Reset H3 Generator" }));

    expect(
      screen.getByPlaceholderText("Describe the scene, action, camera, dialogue, and sound."),
    ).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Landscape" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "5 sec" }).getAttribute("aria-pressed")).toBe("true");
  });
});
