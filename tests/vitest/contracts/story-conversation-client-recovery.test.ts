// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStoryConversation } from "../../../app/app/components/storyCreatorV2/useStoryConversation";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Story Creator client reconnect and offline cancellation", () => {
  it("observes the existing server turn without submitting again and reports an offline cancel safely", async () => {
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
      if (options?.method === "POST") throw new Error("fixture network offline");
      return new Response(JSON.stringify({ turn: { id: "turn-id", projectId: "story-id", status: "running", error: "" }, message: null }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useStoryConversation({ ownerKey: "owner", projectId: "story-id", onMessage: vi.fn() }));
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(async () => { await result.current.refresh(); await result.current.refresh(); });
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
    await act(async () => { await result.current.cancel(); });
    expect(result.current.error).toContain("offline");
    expect(result.current.error).toContain("not resubmitted");
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });
});
