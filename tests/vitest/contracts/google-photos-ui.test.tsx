// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ pick: vi.fn(), close: vi.fn(), navigate: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/client/googlePhotos", async importOriginal => ({
  ...await importOriginal<object>(),
  externalGoogleWindow: () => ({ inApp: true, close: mocks.close, navigate: mocks.navigate, isClosed: () => false }),
  pickGooglePhotos: mocks.pick, googlePhotosRequest: mocks.request,
}));
import ImageSourcePickerBridge from "@/app/app/components/ImageSourcePickerBridge";
import GooglePhotosConnectionPanel from "@/app/app/components/GooglePhotosConnectionPanel";

beforeEach(() => { vi.stubGlobal("React", React); vi.clearAllMocks(); sessionStorage.clear(); mocks.close.mockResolvedValue(undefined); mocks.navigate.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); document.querySelectorAll("input[data-cloud-test]").forEach(e => e.remove()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function field() { const input = document.createElement("input"); input.type = "file"; input.accept = "image/*"; input.dataset.cloudTest = "true"; document.body.append(input); return input; }

it("Cancel keeps existing media and ignores a late successful import", async () => {
  const original = new File(["old"], "original.png", { type: "image/png" });
  const input = field(); Object.defineProperty(input, "files", { value: [original], configurable: true });
  const changed = vi.fn(); input.addEventListener("change", changed);
  let finish!: (files: File[]) => void;
  mocks.pick.mockImplementation(() => new Promise<File[]>(resolve => { finish = resolve; }));
  render(<ImageSourcePickerBridge />); act(() => input.click());
  fireEvent.click(screen.getByRole("button", { name: "Connected Google Photos" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.pick.mock.calls[0][2].aborted).toBe(true);
  await act(async () => finish([new File(["new"], "new.png", { type: "image/png" })]));
  expect(input.files?.[0]).toBe(original); expect(changed).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).toBeNull();
});

it("native X cancellation dismisses waiting without replacing the current upload", async () => {
  mocks.pick.mockRejectedValue(new DOMException("Canceled", "AbortError"));
  render(<ImageSourcePickerBridge />); const input = field(); const changed = vi.fn(); input.addEventListener("change", changed);
  act(() => input.click()); await act(async () => fireEvent.click(screen.getByRole("button", { name: "Connected Google Photos" })));
  expect(screen.queryByRole("dialog")).toBeNull(); expect(changed).not.toHaveBeenCalled();
});

it("blocks a second picker while the first is importing", async () => {
  mocks.pick.mockImplementation(() => new Promise(() => {}));
  render(<ImageSourcePickerBridge />); act(() => field().click());
  fireEvent.click(screen.getByRole("button", { name: "Connected Google Photos" }));
  act(() => field().click()); expect(mocks.pick).toHaveBeenCalledOnce(); expect(screen.getByRole("status")).toHaveTextContent("Opening Google Photos");
});

it("OAuth approval closes the native panel even while the app document is hidden", async () => {
  vi.useFakeTimers(); vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ configured: true, connected: false }))
    .mockResolvedValue(Response.json({ configured: true, connected: true, connecting: false }));
  vi.stubGlobal("fetch", fetcher);
  mocks.request.mockResolvedValue({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", attempt: "test-attempt" });
  await act(async () => { render(<GooglePhotosConnectionPanel />); });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Connect Google Photos" })));
  expect(mocks.navigate).toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(mocks.close).toHaveBeenCalledOnce(); expect(sessionStorage.getItem("otg:google-photos:attempt")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Connected");
});
