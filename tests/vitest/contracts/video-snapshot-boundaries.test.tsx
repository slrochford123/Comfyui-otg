// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VideoSnapshotPicker, { seekSnapshotBoundary } from "@/app/app/components/VideoSnapshotPicker";

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  const NativeURL = URL;
  vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL: vi.fn(() => "blob:video"), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["frame"], { type: "image/jpeg" })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function media(video: HTMLVideoElement, at = 6) {
  Object.defineProperties(video, { duration: { configurable: true, value: 10.125 }, videoWidth: { configurable: true, value: 1920 }, videoHeight: { configurable: true, value: 1080 }, currentTime: { configurable: true, writable: true, value: at } });
}
describe("First / last snapshot buttons", () => {
  it.each([["Use First Frame", 0], ["Use Last Frame", 10.124]] as const)("seeks and inserts %s as a JPEG input, not the old scrubbed frame", async (button, timestamp) => {
    const insert = vi.fn(), close = vi.fn();
    const view = render(<VideoSnapshotPicker open onClose={close} onSnapshot={insert} />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["video"], "source.mp4", { type: "video/mp4" })] } });
    const video = view.container.querySelector("video")!;
    media(video); fireEvent.loadedMetadata(video);
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(video.currentTime).toBeCloseTo(timestamp, 6);
    expect(insert).not.toHaveBeenCalled();
    fireEvent.seeked(video);
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ timestampSeconds: timestamp, width: 1536, height: 864, file: expect.objectContaining({ type: "image/jpeg" }) });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("fails visibly without inserting a stale frame if seeking times out", async () => {
    vi.useFakeTimers();
    const video = document.createElement("video"); media(video);
    const result = seekSnapshotBoundary(video, "last");
    const rejected = expect(result).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5000); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("handles an already-selected first frame without waiting for a seek event", async () => {
    const video = document.createElement("video"); media(video, 0);
    await expect(seekSnapshotBoundary(video, "first")).resolves.toBeUndefined();
  });
  it("cleans up listeners after a decode error", async () => {
    const video = document.createElement("video"); media(video);
    const result = seekSnapshotBoundary(video, "last");
    const rejected = expect(result).rejects.toThrow(/decoded/);
    video.dispatchEvent(new Event("error"));
    await rejected;
  });
  it("keeps the dialog above the header and scrollable on short mobile screens", () => {
    const view = render(<VideoSnapshotPicker open onClose={vi.fn()} onSnapshot={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveClass("z-[12000]");
    expect(view.container.querySelector(".overflow-y-auto")).not.toBeNull();
  });
  it("does not insert a pending capture after the owning view unmounts", async () => {
    const insert = vi.fn(), close = vi.fn();
    const view = render(<VideoSnapshotPicker open onClose={close} onSnapshot={insert} />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["video"], "source.mp4", { type: "video/mp4" })] } });
    const video = view.container.querySelector("video")!;
    media(video); fireEvent.loadedMetadata(video);
    fireEvent.click(screen.getByRole("button", { name: "Use Last Frame" }));
    view.unmount();
    await act(async () => { video.dispatchEvent(new Event("seeked")); });
    expect(insert).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
