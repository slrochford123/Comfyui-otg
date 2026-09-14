// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import H3Panel from "../../../app/app/components/H3Panel";

beforeEach(() => {
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

function writePrompt() {
  fireEvent.change(
    screen.getByPlaceholderText("Describe the scene, action, camera, dialogue, and sound."),
    { target: { value: "Two samurai fight in moonlight." } },
  );
}

describe("H3 orientation and optional Builder UI", () => {
  it("defaults to one landscape selection and retains portrait across modes", () => {
    render(<H3Panel />);
    const landscape = screen.getByRole("button", { name: "Landscape" });
    const portrait = screen.getByRole("button", { name: "Portrait" });

    expect(landscape.getAttribute("aria-pressed")).toBe("true");
    expect(portrait.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(portrait);
    expect(landscape.getAttribute("aria-pressed")).toBe("false");
    expect(portrait.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /Image/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Reference/ }));
    expect(portrait.getAttribute("aria-pressed")).toBe("true");
  });

  it("enables direct T2V from raw text without Enhance or Prompt Builder", () => {
    render(<H3Panel />);
    expect(screen.getByRole("button", { name: /Add Prompt and Required Inputs/ }).hasAttribute("disabled")).toBe(true);
    writePrompt();
    expect(screen.getByRole("button", { name: "Generate Video" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: /Prompt Builder/ }).textContent).toContain("Optional");
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
    writePrompt();
    fireEvent.click(screen.getByRole("button", { name: "Portrait" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate Video" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/h3/generation")).toBe(true);
    });
    const generationCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/h3/generation")!;
    const config = JSON.parse(String((generationCall[1]?.body as FormData).get("config")));
    expect(config).toMatchObject({
      prompt: "Two samurai fight in moonlight.",
      orientation: "portrait",
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/h3/prompt")).toBe(false);
  });

  it("keeps Builder assistance selectable and lets stale output return to raw", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/h3/loras")) {
        return new Response(JSON.stringify({ ok: true, entries: [], maxSelections: 3 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/h3/prompt") {
        return new Response(JSON.stringify({ ok: true, pollUrl: "/api/prompt-result" }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        ok: true,
        status: "completed",
        result: { scenePrompt: "A polished cinematic suggestion." },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<H3Panel />);
    writePrompt();
    fireEvent.click(screen.getByRole("button", { name: /Prompt Builder/ }));
    await screen.findByText("Ollama Suggestion");
    fireEvent.click(screen.getByRole("button", { name: "Use Suggested Prompt" }));
    expect(screen.getByText("Builder prompt selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Portrait" }));
    expect(screen.getByRole("button", { name: /Use Raw Prompt or Review Builder/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Use Current Raw Prompt" }));
    expect(screen.getByRole("button", { name: "Generate Video" }).hasAttribute("disabled")).toBe(false);
  });

  it("enables direct I2V only after a First Image is present", () => {
    render(<H3Panel />);
    fireEvent.click(screen.getByRole("tab", { name: /Image/ }));
    writePrompt();
    expect(screen.getByRole("button", { name: /Add Prompt and Required Inputs/ }).hasAttribute("disabled")).toBe(true);
    const upload = document.querySelector('input[type="file"][accept^="image/*"]') as HTMLInputElement;
    fireEvent.change(upload, {
      target: { files: [new File(["image"], "first.png", { type: "image/png" })] },
    });
    expect(screen.getByRole("button", { name: "Generate Video" }).hasAttribute("disabled")).toBe(false);
  });

  it("enables direct R2V only after a native reference is present", () => {
    render(<H3Panel />);
    fireEvent.click(screen.getByRole("tab", { name: /Reference/ }));
    writePrompt();
    expect(screen.getByRole("button", { name: /Add Prompt and Required Inputs/ }).hasAttribute("disabled")).toBe(true);
    const upload = document.querySelector('input[type="file"][accept^="image/*"]') as HTMLInputElement;
    fireEvent.change(upload, {
      target: { files: [new File(["image"], "hero.png", { type: "image/png" })] },
    });
    expect(screen.getByRole("button", { name: "Generate Video" }).hasAttribute("disabled")).toBe(false);
  });
});
