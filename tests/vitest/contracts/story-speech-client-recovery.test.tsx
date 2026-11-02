// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStorySpeech } from "../../../app/app/components/storyCreatorV2/useStorySpeech";
const capabilities = { available: true, transcription: true,
  engines: { paradee: true, kokoro: true, bark: true }, defaultEngine: "paradee" };
const json = (value: unknown) => ({ ok: true, json: async () => value }) as Response;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear(); fetcher = vi.fn(async () => json({ capabilities })); vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Story read-aloud preferences and reconnection", () => {
  it("detaches an accepted server job without cancelling it on unmount", async () => {
    const { result, unmount } = renderHook(() => useStorySpeech("story-one"));
    await waitFor(() => expect(result.current.engine).toBe("paradee"));
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({job:{id:"accepted-job",status:"running"}});
      throw Error("Connection interrupted");
    });
    await act(async () => result.current.play("message"));
    unmount();
    expect(fetcher.mock.calls.some(([,init]) => init?.body && JSON.parse(String(init.body)).action === "cancel")).toBe(false);
  });
  it("offers Paradee by default and remembers each engine's voice independently", async () => {
    const { result } = renderHook(() => useStorySpeech("story-one"));
    await waitFor(() => expect(result.current.engine).toBe("paradee"));
    expect(result.current.voice).toBe("af_heart");
    act(() => result.current.setVoice("bm_fable"));
    act(() => result.current.setEngine("bark")); expect(result.current.voice).toBe("female");
    act(() => result.current.setVoice("male"));
    act(() => result.current.setEngine("paradee")); expect(result.current.voice).toBe("bm_fable");
    act(() => result.current.setVoice("male")); expect(result.current.voice).toBe("bm_fable");
    act(() => result.current.setEngine("bark")); expect(result.current.voice).toBe("male");
  });
  it("migrates existing Kokoro preference without forcing a new engine", async () => {
    localStorage.setItem("otg.storyCreator.speech.v1", JSON.stringify({engine:"kokoro",voice:"male"}));
    const { result } = renderHook(() => useStorySpeech("story-one"));
    await waitFor(() => expect(result.current.engine).toBe("kokoro"));
    expect(result.current.voice).toBe("male");
  });
  it("rejoins a network-interrupted speech job instead of canceling it", async () => {
    const { result } = renderHook(() => useStorySpeech("story-one"));
    await waitFor(() => expect(result.current.engine).toBe("paradee"));
    let polls = 0;
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({job:{id:"same-job",status:"running"}});
      if (++polls === 1) throw Error("Connection interrupted");
      return json({job:{id:"same-job",status:"completed"},url:"/api/story-creator/speech/media?jobId=same-job"});
    });
    await act(async () => result.current.play("assistant-message"));
    expect(result.current.failedMessageId).toBe("assistant-message");
    await act(async () => result.current.play("assistant-message", true));
    expect(result.current.preparedMessageId).toBe("assistant-message");
    const bodies = fetcher.mock.calls.filter(([,init]) => init?.body).map(([,init]) => JSON.parse(String(init.body)));
    expect(bodies.some(body => body.action === "cancel")).toBe(false);
    expect(bodies.filter(body => body.messageId === "assistant-message")).toHaveLength(2);
  });
  it("ignores a late response from an aborted older selection", async () => {
    const { result } = renderHook(() => useStorySpeech("story-one"));
    await waitFor(() => expect(result.current.engine).toBe("paradee"));
    let release!: (value: Response) => void;
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (body.messageId === "old") return new Promise<Response>(resolve => {release=resolve;});
        return json({job:{id:"new-job"}});
      }
      return json({job:{id:"new-job",status:"completed"},url:"/new-audio"});
    });
    let first!: Promise<void>;
    act(() => { first = result.current.play("old"); });
    await act(async () => result.current.play("new"));
    await act(async () => { release(json({job:{id:"old-job"}})); await first; });
    expect(result.current.preparedMessageId).toBe("new"); expect(result.current.audioUrl).toBe("/new-audio");
  });
});
