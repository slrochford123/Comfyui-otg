// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MossImageControls, { defaultMossSettings } from "@/app/app/components/MossImageControls";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("MOSS live readiness", () => {
  it("does not let a late Ready response replace an active operation's Busy state", async () => {
    let finish!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => { finish = r; })));
    const value = defaultMossSettings("character");
    const { rerender } = render(<MossImageControls value={value} onChange={() => {}} />);
    rerender(<MossImageControls value={value} onChange={() => {}} disabled />);
    await act(async () => finish(Response.json({ message: "Ready — old response" })));
    expect(screen.getByRole("status").textContent).toContain("Busy");
    expect(screen.queryByText("Ready — old response")).toBeNull();
  });
  it("refreshes actual readiness after the operation ends", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ message: "Ready — verified empty queue" }));
    vi.stubGlobal("fetch", fetcher);
    const value = defaultMossSettings("asset");
    const { rerender } = render(<MossImageControls value={value} onChange={() => {}} disabled />);
    expect(fetcher).not.toHaveBeenCalled();
    rerender(<MossImageControls value={value} onChange={() => {}} />);
    await screen.findByText("Ready — verified empty queue");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
