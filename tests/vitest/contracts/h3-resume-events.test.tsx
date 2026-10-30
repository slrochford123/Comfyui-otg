// @vitest-environment jsdom
import React from "react";
import {act, cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
const m = vi.hoisted(() => ({native: false, add: vi.fn()}));
vi.mock("@capacitor/core", () => ({Capacitor: {isNativePlatform: () => m.native}}));
vi.mock("@capacitor/app", () => ({App: {addListener: m.add}}));
import {useH3Resume} from "@/lib/client/useH3Resume";
import {H3_RECOVERY_RESUME_EVENT} from "@/lib/client/h3Recovery";
function Harness({onResume}: {onResume: () => void}) {useH3Resume(onResume); return null;}
afterEach(() => {cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); m.native = false;});
describe("H3 browser and Android foreground recovery", () => {
  it("coalesces a burst of foreground/online events and does not submit on initial mount", async () => {
    vi.useFakeTimers(); const cb = vi.fn(); render(<Harness onResume={cb} />);
    expect(cb).not.toHaveBeenCalled();
    window.dispatchEvent(new Event(H3_RECOVERY_RESUME_EVENT)); window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => vi.advanceTimersByTimeAsync(120)); expect(cb).toHaveBeenCalledTimes(1);
  });
  it("does not run background checks or retain a listener after unmount", async () => {
    vi.useFakeTimers(); const cb = vi.fn(), view = render(<Harness onResume={cb} />);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    window.dispatchEvent(new Event("online")); await act(async () => vi.advanceTimersByTimeAsync(120)); expect(cb).not.toHaveBeenCalled();
    view.unmount(); window.dispatchEvent(new Event("pageshow")); await act(async () => vi.advanceTimersByTimeAsync(120)); expect(cb).not.toHaveBeenCalled();
  });
  it("uses the latest owner callback and removes the actual native App listener", async () => {
    vi.useFakeTimers(); m.native = true; let callback!: (v: {isActive: boolean}) => void;
    const remove = vi.fn(async () => {}); m.add.mockImplementation(async (_event, cb) => {callback = cb; return {remove};});
    const old = vi.fn(), next = vi.fn(), view = render(<Harness onResume={old} />);
    await act(async () => {}); view.rerender(<Harness onResume={next} />);
    callback({isActive: true}); await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(old).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledTimes(1);
    view.unmount(); expect(remove).toHaveBeenCalledTimes(1);
  });
});
