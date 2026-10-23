// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import H3VideoEditPanel from "@/app/app/components/H3VideoEditPanel";
import H3StudioControls from "@/app/app/components/H3StudioControls";

// Real source registration/planning boundary; frame decoder itself is tested separately.
vi.mock("@/app/app/components/VideoSnapshotPicker", () => ({ default: ({ open, onSnapshot, onClose }: any) => open ? <button onClick={() => { onSnapshot({ file: new File(["frame"], "snapshot.jpg", { type: "image/jpeg" }) }); onClose(); }}>Insert captured fixture frame</button> : null }));
const json = (value: unknown) => new Response(JSON.stringify(value));
let server: ReturnType<typeof vi.fn>, ids: number;
beforeEach(() => {
  localStorage.clear(); ids = 0;
  const NativeURL = URL;
  vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL: vi.fn(() => "blob:source"), revokeObjectURL: vi.fn() }));
  server = vi.fn(async (input, init) => {
    const url = String(input);
    if (url === "/api/h3/generation/upload" && init?.method === "POST") return json({ upload: { id: "upload" } });
    if (url === "/api/h3/video-edit/source" && init?.method === "POST") return json({ asset: { id: "selection", duration: 10, name: "prepared.mp4", url: "/api/h3/video-edit/source?id=selection" } });
    if (url.includes("/api/h3/video-edit/source?id=")) return new Response(new TextEncoder().encode("selected video"), { headers: { "Content-Type": "video/mp4" } });
    if (url === "/api/h3/studio/media" && init?.method === "POST") {
      const form = init.body as FormData, file = form.get("file") as File;
      return json({ ok: true, asset: { id: `asset-${++ids}`, kind: file.type.split("/")[0], role: form.get("role"), name: file.name, sha256: "fixture", version: 1, metadata: { durationSeconds: 10, hasAudio: true }, url: `/api/h3/studio/media?id=asset-${ids}` } });
    }
    if (url === "/api/h3/studio" && init?.method === "POST") return json({ ok: true, review: { id: "review", mediaFingerprint: "bound" }, manifest: { executable: false, blockedReasons: [], steps: 8, sampler: "euler" }, estimate: { explanation: "No generation submitted" } });
    return json({ ok: true, catalog: [] });
  }); vi.stubGlobal("fetch", server);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function reviewBody() { return JSON.parse(server.mock.calls.findLast(([url, init]) => String(url) === "/api/h3/studio" && init?.method === "POST")![1].body); }
describe("H3 Edit Video tab uses the attached reference architecture", () => {
  it("shows only source, trim, MP, prompt and one direct Create action", async () => {
    const view = render(<H3VideoEditPanel authenticatedOwnerKey="qa" onBack={vi.fn()} />);
    expect(screen.getByLabelText("Megapixel size")).toBeVisible();
    expect(screen.getAllByRole("option").map(v => v.textContent)).toEqual(["0.2 MP", "0.6 MP", "1 MP"]);
    for (const name of [/Auto Mode/, /Manual Mode/, /Review/, /Accept/, /Native/, /Select 5 seconds/]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Editing workflow")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Aspect")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Duration")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("H3 video edit prompt"), { target: { value: "Make the coat blue" } });
    fireEvent.change(screen.getByLabelText("Megapixel size"), { target: { value: "1" } });
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["video"], "source.mp4", { type: "video/mp4" })] } });
    await screen.findByText(/Full video ready/);
    expect(screen.getByRole("button", { name: "Create Video" })).toBeEnabled();
    server.mockImplementationOnce(async () => json({ job: { id: "job", status: "completed", statusMessage: "Video complete", videoUrl: "/api/h3/generation/media?jobId=job", galleryStatus: "saved", durationSeconds: 10 } }));
    fireEvent.click(screen.getByRole("button", { name: "Create Video" }));
    await screen.findByText("Video complete");
    const calls = server.mock.calls.filter(([url]) => url === "/api/h3/video-edit/simple");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][1].body)).toMatchObject({ sourceId: "selection", prompt: "Make the coat blue", quality: "1" });
    expect(Object.keys(JSON.parse(calls[0][1].body)).sort()).toEqual(["prompt", "quality", "requestId", "sourceId"]);
    expect(screen.getByRole("link", { name: "Download Video" })).toHaveAttribute("href", "/api/h3/generation/media?jobId=job&download=1");
    expect(screen.getByRole("button", { name: "Expand Video" })).toBeVisible();
    expect(screen.getByText(/Saved to Gallery/)).toBeVisible();
    expect(server.mock.calls.some(([url]) => url === "/api/h3/studio/execute" || url === "/api/h3/studio")).toBe(false);
  });
  it("accepts the owner's middle 4.76-second selection without rounding to five seconds", async () => {
    const original = server.getMockImplementation()!;
    server.mockImplementation((input, init) => {
      if (String(input) === "/api/h3/video-edit/source" && init?.method === "POST") {
        const data = JSON.parse(init.body);
        return Promise.resolve(json({ asset: { id: data.action === "trim" ? "trimmed" : "long", duration: data.action === "trim" ? data.end - data.start : 19, name: "source.mp4", url: "/api/h3/video-edit/source?id=selected" } }));
      }
      return original(input, init);
    });
    const view = render(<H3VideoEditPanel authenticatedOwnerKey="qa" onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("H3 video edit prompt"), { target: { value: "Keep the motion" } });
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["video"], "long.mp4", { type: "video/mp4" })] } });
    await screen.findByRole("button", { name: "Trim Selection" });
    fireEvent.change(screen.getByLabelText("Trim start seconds"), { target: { value: "10.28" } });
    fireEvent.change(screen.getByLabelText("Trim end seconds"), { target: { value: "15.04" } });
    expect(screen.getByRole("button", { name: "Create Video" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Trim Selection" }));
    await screen.findByText(/Trimmed clip preview · 4.76 sec/);
    expect(screen.getByRole("button", { name: "Create Video" })).toBeEnabled();
    expect(screen.getByLabelText("H3 video edit prompt")).toHaveValue("Keep the motion");
    fireEvent.change(screen.getByLabelText("Trim end seconds"), { target: { value: "16" } });
    expect(screen.getByRole("button", { name: "Create Video" })).toBeDisabled();
  });
  it("rejects image uploads without hiding MP or prompt", () => {
    const view = render(<H3VideoEditPanel authenticatedOwnerKey="qa" onBack={vi.fn()} />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["image"], "bad.jpg", { type: "image/jpeg" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a video");
    expect(screen.getByLabelText("Megapixel size")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create Video" })).toBeDisabled();
  });
  it("keeps cancelling non-terminal and offers a new request only after backend cancellation", async () => {
    const original = server.getMockImplementation()!;
    server.mockImplementation((input, init) => {
      if (String(input) === "/api/h3/video-edit/simple") return Promise.resolve(json({ job: { id: "job", status: "running", statusMessage: "Rendering", approximatePreview: { imageUrl: "data:image/jpeg;base64,aGVsbG8=" } } }));
      if (String(input) === "/api/h3/generation" && init?.method === "POST") return Promise.resolve(json({ job: { id: "job", status: "canceling", statusMessage: "Waiting for backend cancellation" } }));
      return original(input, init);
    });
    const view = render(<H3VideoEditPanel authenticatedOwnerKey="qa" onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("H3 video edit prompt"), { target: { value: "Blue coat" } });
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["video"], "source.mp4", { type: "video/mp4" })] } });
    await screen.findByText(/Full video ready/);
    fireEvent.click(screen.getByRole("button", { name: "Create Video" }));
    await screen.findByText("Rendering");
    expect(screen.getByRole("img", { name: "Generation preview" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Generation preview" })).toHaveAttribute("src", "data:image/jpeg;base64,aGVsbG8=");
    fireEvent.click(screen.getByRole("button", { name: "Safe Cancel" }));
    await screen.findByText("Waiting for backend cancellation");
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
  it("inserts snapshots into distinct first and last image roles without replacing the first input", async () => {
    render(<H3StudioControls ownerKey="qa" />);
    fireEvent.click(screen.getByRole("button", { name: "First-frame input from video" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert captured fixture frame" }));
    await screen.findByText(/Ready · version 1/);
    fireEvent.click(screen.getByRole("button", { name: "Last-frame input from video" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert captured fixture frame" }));
    await waitFor(() => expect(screen.getAllByText(/Ready · version 1/)).toHaveLength(2));
    const uploads = server.mock.calls.filter(([url, init]) => String(url) === "/api/h3/studio/media" && init?.method === "POST");
    expect(uploads.map(([, init]) => (init.body as FormData).get("role"))).toEqual(["first", "last"]);
    fireEvent.change(screen.getByLabelText("Video description"), { target: { value: "Transition from the first frame to the last" } });
    fireEvent.click(screen.getByRole("button", { name: "Manual Mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview Video Plan (no cost)" }));
    await screen.findByLabelText("Reviewed video plan");
    expect(reviewBody()).toMatchObject({ plan: { workflowId: "native-i2v" }, mediaIds: ["asset-1", "asset-2"] });
  });
});
