// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ native: vi.fn(), available: vi.fn(), open: vi.fn(), close: vi.fn(), listen: vi.fn(), remove: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mocks.native, isPluginAvailable: mocks.available },
  registerPlugin: () => ({ open: mocks.open, close: mocks.close, addListener: mocks.listen }),
}));
import { externalGoogleWindow, type GoogleWindow } from "@/lib/client/googleBrowser";
import { googlePhotosRequest, pickGooglePhotos } from "@/lib/client/googlePhotos";

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.native.mockReturnValue(true); mocks.available.mockReturnValue(true);
  mocks.open.mockResolvedValue(undefined); mocks.close.mockResolvedValue(undefined);
  mocks.listen.mockResolvedValue({ remove: mocks.remove.mockResolvedValue(undefined) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function input(multiple = false) { const field = document.createElement("input"); field.type = "file"; field.accept = "image/*"; field.multiple = multiple; return field; }
function panel(): GoogleWindow { return { inApp: true, navigate: vi.fn(async () => {}), close: vi.fn(async () => {}), isClosed: vi.fn(() => false) }; }
const session = { id: "test-session", pickerUri: "https://photos.google.com/picker/test", pollAfterMs: 1000 };
const items = [{ id: "b", name: "second.png", mime: "image/png" }, { id: "a", name: "first.png", mime: "image/png" }];

describe("app-attached Google browser", () => {
  it("opens native Custom Tabs without a Chrome window and closes only its own session", async () => {
    const webOpen = vi.spyOn(window, "open");
    const browser = externalGoogleWindow()!;
    await browser.navigate(session.pickerUri);
    expect(webOpen).not.toHaveBeenCalled(); expect(browser.inApp).toBe(true);
    const { id } = mocks.open.mock.calls[0][0];
    expect(mocks.open).toHaveBeenCalledWith({ url: session.pickerUri, id });
    mocks.listen.mock.calls[0][1]({ id: "unrelated" }); expect(browser.isClosed()).toBe(false);
    await browser.close(); await browser.close();
    expect(mocks.close).toHaveBeenCalledExactlyOnceWith({ id }); expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
  it("honors native X/Back dismissal and does not reopen or close another panel", async () => {
    const browser = externalGoogleWindow()!; await browser.navigate(session.pickerUri);
    mocks.listen.mock.calls[0][1]({ id: mocks.open.mock.calls[0][0].id });
    expect(browser.isClosed()).toBe(true); await browser.close(); expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it("cleans up if cancellation races native opening", async () => {
    let ready!: () => void;
    mocks.open.mockImplementationOnce(() => new Promise<void>(resolve => { ready = resolve; }));
    const browser = externalGoogleWindow()!; const opening = browser.navigate(session.pickerUri);
    await vi.advanceTimersByTimeAsync(0); const closing = browser.close();
    ready(); await opening; await closing;
    expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it("does not launch a canceled panel after an asynchronous connect request", async () => {
    const browser = externalGoogleWindow()!; await browser.close();
    await expect(browser.navigate(session.pickerUri)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.listen).not.toHaveBeenCalled();
  });
  it("keeps the normal web popup fallback", async () => {
    mocks.native.mockReturnValue(false);
    const popup = { opener: {}, document: { title: "" }, location: { href: "about:blank" }, closed: false, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const browser = externalGoogleWindow()!; await browser.navigate(session.pickerUri); await browser.close();
    expect(browser.inApp).toBe(false); expect(popup.opener).toBeNull(); expect(popup.location.href).toBe(session.pickerUri); expect(popup.close).toHaveBeenCalledOnce();
  });
  it("recognizes old wrappers without requiring the new native plugin", () => {
    mocks.available.mockReturnValue(false); expect(externalGoogleWindow()?.inApp).toBe(false); expect(mocks.open).not.toHaveBeenCalled();
  });
});

describe("Google selection returns before importing", () => {
  it("closes after Done before downloading, preserves order and does not mutate input", async () => {
    const browser = panel(), field = input(true), status = vi.fn(); field.dataset.maxFiles = "4";
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(session)).mockResolvedValueOnce(Response.json({ ready: true, items }))
      .mockImplementation(async () => { expect(browser.close).toHaveBeenCalled(); return new Response(new Blob(["image"], { type: "image/png" })); });
    vi.stubGlobal("fetch", fetcher);
    const result = pickGooglePhotos(field, browser, new AbortController().signal, status);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).map(file => file.name)).toEqual(["second.png", "first.png"]);
    expect(browser.navigate).toHaveBeenCalledWith(session.pickerUri + "/autoclose");
    expect(field.files?.length).toBe(0); expect(status.mock.calls[0][0]).toContain("automatically");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).maximum).toBe(4);
  });
  it("treats X/Back as cancellation after checking for a completed selection", async () => {
    const browser = panel(); vi.mocked(browser.isClosed).mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(session)).mockResolvedValueOnce(Response.json({ ready: false })));
    const result = expect(pickGooglePhotos(input(), browser, new AbortController().signal, vi.fn())).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1000); await result; expect(browser.close).toHaveBeenCalled();
  });
  it("still imports when Google's auto-close precedes the ready poll", async () => {
    const browser = panel(); vi.mocked(browser.isClosed).mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(session)).mockResolvedValueOnce(Response.json({ ready: true, items: [] })));
    const result = pickGooglePhotos(input(), browser, new AbortController().signal, vi.fn());
    await vi.advanceTimersByTimeAsync(1000); expect(await result).toEqual([]);
  });
  it("cancel stops polling and closes the panel without changing inputs", async () => {
    const browser = panel(), abort = new AbortController(), field = input();
    const fetcher = vi.fn().mockResolvedValue(Response.json(session)); vi.stubGlobal("fetch", fetcher);
    const result = expect(pickGooglePhotos(field, browser, abort.signal, vi.fn())).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0); abort.abort(); await result; await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledOnce(); expect(browser.close).toHaveBeenCalled(); expect(field.files?.length).toBe(0);
  });
  it("rejects blocked popups and full workflows before creating a provider session", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(pickGooglePhotos(input(), null, new AbortController().signal, vi.fn())).rejects.toThrow(/pop-ups/);
    const field = input(true); field.dataset.maxFiles = "0";
    await expect(pickGooglePhotos(field, panel(), new AbortController().signal, vi.fn())).rejects.toThrow(/remaining/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("replaces raw HTML JSON errors with an actionable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!DOCTYPE html><title>Proxy</title>", { status: 502 })));
    await expect(googlePhotosRequest("pick")).rejects.toThrow(/current inputs were kept/);
  });
});
