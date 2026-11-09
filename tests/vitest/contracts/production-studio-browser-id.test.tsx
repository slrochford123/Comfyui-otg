// @vitest-environment jsdom
import React from "react";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useStudio } from "@/app/app/components/production-studio/useStudio";
import { Editor } from "@/app/app/components/production-studio/Editor";
import { EMPTY_TIMELINE, type Project, type Asset } from "@/lib/productionStudio/model";
import { normalizeStoryProductionPlan } from "@/lib/storyCreator/productionPlan";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fixture(): Project {
  return {
    schemaVersion: 1, id: "project", name: "Coffee shop", revision: 49,
    createdAt: "", updatedAt: "", storyProjectId: null, storyPlanVersion: null,
    brief: { description: "Keep my story", format: "movie", style: "", atmosphere: "", aspect: "landscape", targetSeconds: 60 },
    plan: normalizeStoryProductionPlan({ acts: [] }, "project"), shots: {}, bindings: [],
    timeline: structuredClone(EMPTY_TIMELINE), history: [], future: [], assistant: [],
  };
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("React", React);
  // Same API availability as an Android browser visiting the private HTTP site.
  vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("Production v.2 without crypto.randomUUID", () => {
  it("submits explicitly approved jobs with valid independent IDs and the saved revision", async () => {
    const project = fixture();
    const fetcher = vi.fn(async () => Response.json({ project, assets: [], jobs: [] }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useStudio("owner", "project"));
    await waitFor(() => expect(result.current.saved).toBe(true));
    const posts = () => fetcher.mock.calls.filter((call: unknown[]) => (call[1] as RequestInit)?.method === "POST");
    expect(posts()).toHaveLength(0);
    await act(() => result.current.job({ kind: "storyboard", shotId: "shot" }));
    await act(() => result.current.job({ kind: "export" }));
    const bodies = posts().map((call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.requestKey).toMatch(uuid);
      expect(body).toMatchObject({ approved: true, revision: 49 });
    }
    expect(bodies[0].requestKey).not.toBe(bodies[1].requestKey);
    expect(project.revision).toBe(49);
    expect(project.brief.description).toBe("Keep my story");
  });

  it("creates clip, split, duplicate, audio and title IDs without replacing existing IDs", () => {
    let project = fixture();
    const assets = [{ id: "video", kind: "video", name: "Video", metadata: { duration: 3 } },
      { id: "voice", kind: "audio", name: "Voice", metadata: { duration: 2 } }] as Asset[];
    const change = vi.fn((op) => { project = { ...project, timeline: op.timeline }; });
    const studio = () => ({ project, assets, jobs: [], change, saved: true, scopeKey: "test", job: vi.fn(), setError: vi.fn(), request: vi.fn(), url: "/api/production-studio/projects/project" }) as unknown as ReturnType<typeof useStudio>;
    const view = render(<Editor s={studio()} run={vi.fn()} />);
    const sync = () => view.rerender(<Editor s={studio()} run={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Add uploaded clip or still"), { target: { value: "video" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to timeline" })); sync();
    const originalId = project.timeline.clips[0].id;
    fireEvent.click(screen.getByRole("button", { name: "Duplicate", exact: true })); sync();
    const duplicateId = project.timeline.clips[1].id;
    fireEvent.click(screen.getAllByRole("button", { name: "Split", exact: true })[0]); sync();
    fireEvent.change(screen.getByLabelText("Production audio"), { target: { value: "voice" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Dialogue at Playhead" })); sync();
    fireEvent.click(screen.getByRole("button", { name: "+ Title or caption" })); sync();
    const ids = [...project.timeline.clips, ...project.timeline.audio, ...project.timeline.titles].map(x => x.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    ids.forEach(id => expect(id).toMatch(uuid));
    expect(project.timeline.clips[0].id).toBe(originalId);
    expect(project.timeline.clips[2].id).toBe(duplicateId);
    expect(project.timeline.clips[0].out).toBe(1);
    expect(project.timeline.clips[1].in).toBe(1);
  });
});
