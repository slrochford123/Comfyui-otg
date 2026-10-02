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

import H3AdvancedControls from "../../../app/app/components/H3AdvancedControls";
import H3Panel from "../../../app/app/components/H3Panel";
import { DEFAULT_H3_ADVANCED_SETTINGS } from "../../../lib/production/h3Settings";

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
  it("renders shared advanced H3 controls with safe defaults and mode fallbacks", () => {
    render(<H3Panel />);
    const turbo = screen.getByRole("button", { name: "Turbo" });
    const native = screen.getByRole("button", { name: "Native" });
    const standard = screen.getByRole("button", { name: "Standard" });
    const singularity = screen.getByRole("button", { name: "Singularity" });
    const refMod = screen.getByRole("button", { name: "RefMod" });
    const motion = screen.getByRole("button", { name: "Motion" });

    expect(turbo.getAttribute("aria-pressed")).toBe("true");
    expect(native.getAttribute("aria-pressed")).toBe("false");
    expect(standard.getAttribute("aria-pressed")).toBe("true");
    expect(singularity.getAttribute("aria-pressed")).toBe("false");
    expect(refMod.getAttribute("aria-pressed")).toBe("false");
    expect(motion.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "Balanced" })).toBeNull();

    fireEvent.click(singularity);
    expect(turbo.getAttribute("aria-pressed")).toBe("true");
    expect(native.getAttribute("aria-pressed")).toBe("false");
    expect(singularity.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(native);
    expect(native.getAttribute("aria-pressed")).toBe("true");
    expect(singularity.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(turbo);
    expect(turbo.getAttribute("aria-pressed")).toBe("true");
    expect(singularity.getAttribute("aria-pressed")).toBe("true");

    expect(refMod.hasAttribute("disabled")).toBe(true);
    fireEvent.click(refMod);
    expect(refMod.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("RefMod target")).toBeNull();
  });

  it("wires RefMod controls only when an image reference target exists", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <H3AdvancedControls
        value={{
          ...DEFAULT_H3_ADVANCED_SETTINGS,
          refMod: { enabled: true, strength: "strong" },
        }}
        onChange={onChange}
        referenceOptions={[]}
      />,
    );

    expect(screen.getByRole("button", { name: "RefMod" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "RefMod" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "Strong" })).toBeNull();

    rerender(
      <H3AdvancedControls
        value={DEFAULT_H3_ADVANCED_SETTINGS}
        onChange={onChange}
        referenceOptions={[{ label: "Picture 1" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "RefMod" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_H3_ADVANCED_SETTINGS,
      refMod: { enabled: true, strength: "balanced" },
    });

    rerender(
      <H3AdvancedControls
        value={{
          ...DEFAULT_H3_ADVANCED_SETTINGS,
          refMod: { enabled: true, strength: "balanced" },
        }}
        onChange={onChange}
        referenceOptions={[{ label: "Hero" }, { label: "Villain" }]}
      />,
    );
    expect(screen.getByRole("button", { name: "Balanced" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Strong" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("RefMod target")).toBeTruthy();
  });

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

  it("restores quoted dialogue when Ollama omits it from the suggestion", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/h3/loras")) {
        return new Response(JSON.stringify({ ok: true, entries: [], maxSelections: 3 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/h3/prompt") {
        return new Response(JSON.stringify({ ok: true, pollUrl: "/api/prompt-dialogue-result" }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        ok: true,
        status: "completed",
        result: { scenePrompt: "Two friends face each other in a tense close-up." },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<H3Panel />);
    fireEvent.change(
      screen.getByPlaceholderText("Describe the scene, action, camera, dialogue, and sound."),
      { target: { value: 'Maya says "You promised." Jo answers “I know.”' } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Prompt Builder/ }));

    const suggestion = await screen.findByDisplayValue(
      /Spoken dialogue — preserve verbatim:/,
    ) as HTMLTextAreaElement;
    expect(suggestion.value).toContain('"You promised."');
    expect(suggestion.value).toContain('“I know.”');
  });

  it("offers final prompt play, pause, stop, and volume controls", () => {
    const cancel = vi.fn();
    const speak = vi.fn();
    const pause = vi.fn();
    const resume = vi.fn();
    class Utterance {
      text: string;
      volume = 1;
      rate = 1;
      voice: SpeechSynthesisVoice | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal("speechSynthesis", {
      cancel,
      speak,
      pause,
      resume,
      getVoices: () => [],
    });
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);

    render(<H3Panel />);
    writePrompt();
    fireEvent.click(screen.getByRole("button", { name: "Show final prompt audio controls" }));
    fireEvent.change(screen.getByRole("slider", { name: "Final prompt volume" }), {
      target: { value: "0.6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Play final prompt" }));

    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0].text).toBe("Two samurai fight in moonlight.");
    expect(speak.mock.calls[0][0].volume).toBe(0.6);
    expect(screen.getByRole("button", { name: "Pause final prompt" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pause final prompt" }));
    expect(pause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Play final prompt" }));
    expect(resume).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Stop final prompt" }));
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("records a phone-compatible voice prompt from the mic icon", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/h3/loras")) {
        return new Response(JSON.stringify({ ok: true, entries: [], maxSelections: 3 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, text: "A girl wins rock paper scissors." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    class Recorder {
      static isTypeSupported(type: string) {
        return type === "audio/mp4";
      }
      mimeType: string;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: unknown, options?: { mimeType?: string }) {
        this.mimeType = options?.mimeType || "audio/webm";
      }
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.stubGlobal("MediaRecorder", Recorder);

    render(<H3Panel />);
    fireEvent.click(screen.getByRole("button", { name: "Record voice prompt" }));
    await screen.findByRole("button", { name: "Stop voice prompt recording" });
    fireEvent.click(screen.getByRole("button", { name: "Stop voice prompt recording" }));

    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText(
          "Describe the scene, action, camera, dialogue, and sound.",
        ) as HTMLTextAreaElement).value,
      ).toBe("A girl wins rock paper scissors.");
    });
    const transcriptionCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/ollama-ai/transcribe",
    );
    expect(transcriptionCall).toBeTruthy();
    const audio = (transcriptionCall?.[1]?.body as FormData).get("audio") as File;
    expect(audio.type).toBe("audio/mp4");
    expect(audio.name.endsWith(".mp4")).toBe(true);
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
