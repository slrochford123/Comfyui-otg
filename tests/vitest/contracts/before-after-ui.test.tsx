// @vitest-environment jsdom
import React from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import ImageComparisonSlider from "@/app/app/components/ImageComparisonSlider";
import BeforeAfterPanel from "@/app/app/components/BeforeAfterPanel";
import {emptyComparisonDraft} from "@/lib/client/beforeAfter";
const persistence = vi.hoisted(() => ({load: vi.fn(), save: vi.fn()}));
vi.mock("@/lib/client/beforeAfter", async original => ({...await original<typeof import("@/lib/client/beforeAfter")>(), loadComparison: persistence.load, saveComparison: persistence.save}));
beforeEach(() => {
  persistence.save.mockResolvedValue(undefined); persistence.load.mockResolvedValue({draft: emptyComparisonDraft(), source: null});
  vi.stubGlobal("fetch", vi.fn()); URL.createObjectURL = vi.fn(() => "blob:original"); URL.revokeObjectURL = vi.fn();
});
afterEach(() => {cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals();});
describe("Accessible comparison slider", () => {
  it("shows two aligned contain layers without resizing the overlay as the slider moves", () => {
    const {container} = render(<ImageComparisonSlider before="/original" after="/edited" position={50} onChange={() => {}} />);
    expect(screen.getByAltText("After: edited image").className).toContain("object-contain");
    expect(container.querySelector('[style*="clip-path"]')?.getAttribute("style")).toContain("50%");
    expect(screen.getByAltText("Before: original image").getAttribute("src")).toBe("/original");
  });
  it("supports a keyboard-accessible native slider with an understandable label", () => {
    const change = vi.fn(); render(<ImageComparisonSlider before="/a" after="/b" position={50} onChange={change} />);
    fireEvent.change(screen.getByRole("slider", {name: "Before and after comparison"}), {target: {value: "25"}}); expect(change).toHaveBeenCalledWith(25);
  });
  it("clamps restored positions to the image bounds", () => {
    render(<ImageComparisonSlider before="/a" after="/b" position={150} onChange={() => {}} />);
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("100");
  });
  it("fits the comparison canvas to a portrait original, rather than sliding across black margins", () => {
    const {container} = render(<ImageComparisonSlider before="/a" after="/b" position={50} onChange={() => {}} />);
    const image = screen.getByAltText("Before: original image");
    Object.defineProperty(image, "naturalWidth", {value: 768}); Object.defineProperty(image, "naturalHeight", {value: 1024}); fireEvent.load(image);
    expect(container.querySelector('[data-otg="before-after-comparison"]')?.getAttribute("style")).toContain("48.75vh");
  });
});
describe("Compact before/after editor", () => {
  it("does not generate without an original and a prompt", async () => {
    render(<BeforeAfterPanel owner="alice" />); await screen.findByRole("button", {name: "Add Image"});
    expect(screen.getByRole("button", {name: "Generate Edit"}).hasAttribute("disabled")).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("restores the exact result and separates Undo from deleting Gallery files", async () => {
    persistence.load.mockResolvedValue({source: new File(["original"], "source.png"), draft: {...emptyComparisonDraft(), prompt: "Black suit", position: 32, job: {jobId: "exact", engine: "qwen", status: "completed", imageUrl: "/api/images/before-after?jobId=exact&image=1", seed: 1}}});
    render(<BeforeAfterPanel owner="alice" />); await screen.findByAltText("After: edited image");
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("32");
    fireEvent.click(screen.getByRole("button", {name: "Undo", exact: true}));
    expect(screen.queryByAltText("After: edited image")).toBeNull(); expect(screen.getByAltText("Original image")).toBeTruthy();
    expect((screen.getByRole("textbox", {name: "Describe the change"}) as HTMLTextAreaElement).value).toBe("Black suit"); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not overwrite saved state before hydration, including StrictMode", async () => {
    let finish: (value: unknown) => void = () => {}; persistence.load.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    const view = render(<React.StrictMode><BeforeAfterPanel owner="alice" /></React.StrictMode>);
    expect(persistence.save).not.toHaveBeenCalled();
    finish({draft: emptyComparisonDraft(), source: null}); await waitFor(() => expect(screen.getByRole("button", {name: "Add Image"}).hasAttribute("disabled")).toBe(false));
    view.unmount(); expect(persistence.save).toHaveBeenCalledWith("alice", expect.objectContaining({version: 1}));
  });
  it("recovers a phone-terminated upload with the same durable job, not a fresh render", async () => {
    const job = {jobId: "saved-upload-id", engine: "qwen", seed: 123, status: "submitting"};
    persistence.load.mockResolvedValue({source: new File(["original"], "source.png"), draft: {...emptyComparisonDraft(), prompt: "Black suit", job}});
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({error: "Not found"}, {status: 404})).mockResolvedValueOnce(Response.json({...job, status: "queued"}));
    vi.stubGlobal("fetch", fetcher); render(<BeforeAfterPanel owner="alice" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const form = fetcher.mock.calls[1][1].body as FormData;
    expect(form.get("clientRequestId")).toBe("saved-upload-id"); expect(form.get("seed")).toBe("123"); expect(form.get("prompt")).toBe("Black suit");
    expect(screen.getByRole("button", {name: "Editing…"}).hasAttribute("disabled")).toBe(true);
  });
});
