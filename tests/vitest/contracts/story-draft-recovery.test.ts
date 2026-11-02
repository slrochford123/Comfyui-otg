// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStoryDraft } from "../../../app/app/components/storyCreatorV2/useStoryDraft";

afterEach(() => { cleanup(); localStorage.clear(); });
describe("device-local unsent Story Creator drafts", () => {
  it("restores a draft without sending and isolates owners, projects and fields", async () => {
    const { result, rerender, unmount } = renderHook(({ owner, project, field }) => useStoryDraft(owner, project, field),
      { initialProps: { owner: "alice", project: "one", field: "ideas" } });
    act(() => result.current[1]("Mara opens the café."));
    const clearEarlierProject = result.current[1];
    rerender({ owner: "alice", project: "two", field: "ideas" });
    await waitFor(() => expect(result.current[0]).toBe(""));
    act(() => result.current[1]("Another story."));
    act(() => clearEarlierProject(""));
    expect(result.current[0]).toBe("Another story.");
    // Restore a new idea in the first project before checking normal recovery.
    localStorage.setItem("otg:story:draft:v1:alice:one:ideas", "Mara opens the café.");
    rerender({ owner: "alice", project: "one", field: "ideas" });
    await waitFor(() => expect(result.current[0]).toBe("Mara opens the café."));
    rerender({ owner: "bob", project: "one", field: "ideas" });
    await waitFor(() => expect(result.current[0]).toBe(""));
    rerender({ owner: "alice", project: "one", field: "writing-direction" });
    await waitFor(() => expect(result.current[0]).toBe(""));
    unmount();
    const restored = renderHook(() => useStoryDraft("alice", "one", "ideas"));
    await waitFor(() => expect(restored.result.current[0]).toBe("Mara opens the café."));
    act(() => restored.result.current[1](""));
    expect(localStorage.getItem("otg:story:draft:v1:alice:one:ideas")).toBeNull();
  });
});
