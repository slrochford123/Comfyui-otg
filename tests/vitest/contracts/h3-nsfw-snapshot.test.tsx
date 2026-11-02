// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import H3NsfwStudio from "@/app/app/components/H3NsfwStudio";
import { DEFAULT_LAB_SETTINGS, EXPERIMENTS } from "@/lib/experiments/catalog";
let session: any, uploads: File[], finishUpload: (ok?: boolean) => void, server: ReturnType<typeof vi.fn>;
const response = (data: unknown) => new Response(JSON.stringify(data));
beforeEach(() => {
  vi.stubGlobal("React", React); uploads = [];
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  const NativeURL = URL;
  vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL: vi.fn(() => "blob:video"), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["frame"], { type: "image/jpeg" })));
  session = { id: "draft", experiment: "prism-pika", title: "Draft", revision: 1, assets: [{ id: "old", name: "old.png", mime: "image/png", role: "source" }], settings: { ...DEFAULT_LAB_SETTINGS, prompt: "A paper boat.", selectedSources: ["old"] } };
  server = vi.fn(async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    if (String(url).includes("?jobs=")) return response({ jobs: [], session });
    if (body?.action === "update") { session = { ...body, revision: session.revision + 1 }; return response({ session }); }
    return response({ catalog: EXPERIMENTS.filter(e => e.kind === "h3-admin"), sessions: [session], capabilities: [{ model: "prism-pika", modes: ["text", "image", "reference", "edit", "edit-image"], recipe: { steps: 8 } }] });
  });
  vi.stubGlobal("fetch", server);
  vi.stubGlobal("XMLHttpRequest", class {
    upload = {}; status = 0; responseText = ""; onload = () => {}; open() {} setRequestHeader() {} abort() {}
    send(file: File) {
      uploads.push(file);
      finishUpload = (ok = true) => {
        this.status = ok ? 201 : 503;
        if (ok) session = { ...session, assets: [...session.assets, { id: "snapshot", name: file.name, mime: file.type, role: "source" }] };
        this.responseText = JSON.stringify(ok ? { session } : { error: "Snapshot upload unavailable" }); this.onload();
      };
    }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  render(<H3NsfwStudio />); fireEvent.click(await screen.findByRole("button", { name: "Snapshot", exact: true }));
  const dialog = screen.getByRole("dialog", { name: "Snapshot from Video" });
  expect(screen.getByRole("region", { name: "H3 NSFW workspace" })).not.toContainElement(dialog);
  fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [new File(["original video"], "source.mp4", { type: "video/mp4" })] } });
  const video = dialog.querySelector("video")!;
  Object.defineProperties(video, { duration: { configurable: true, value: 10 }, videoWidth: { configurable: true, value: 1920 }, videoHeight: { configurable: true, value: 1080 }, currentTime: { configurable: true, writable: true, value: 2.5 } });
  fireEvent.loadedMetadata(video);
  return dialog;
}
it.each(["reference", "edit", "image", "edit-image"])("adds a JPEG frame in %s mode, retaining originals and never generating", async mode => {
  session.settings.mode = mode;
  const dialog = await open(); fireEvent.click(within(dialog).getByRole("button", { name: "Use Snapshot", exact: true }));
  await waitFor(() => expect(uploads).toHaveLength(1));
  expect(uploads[0]).toMatchObject({ name: "snapshot_source_00-02-500.jpg", type: "image/jpeg" });
  expect(within(dialog).getByRole("button", { name: "Use Snapshot", exact: true })).toBeDisabled();
  fireEvent.keyDown(window, { key: "Escape" }); expect(dialog).toBeInTheDocument();
  await act(async () => finishUpload());
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(session.settings.selectedSources).toEqual(["image", "edit-image"].includes(mode) ? ["snapshot"] : ["old", "snapshot"]);
  expect(session.assets).toHaveLength(2); expect(session.settings.prompt).toBe("A paper boat.");
  expect(server.mock.calls.some(([, o]) => o?.body && JSON.parse(o.body).action === "generate")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Remove snapshot_source_00-02-500.jpg" }));
  expect(screen.queryByRole("article", { name: "Reference snapshot_source_00-02-500.jpg" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo removal" }));
  expect(screen.getByRole("article", { name: "Reference snapshot_source_00-02-500.jpg" })).toBeInTheDocument();
  expect(screen.getByText("Saved", { exact: true })).toBeInTheDocument();
});
it("keeps a failed upload open and allows retry without removing existing inputs", async () => {
  const dialog = await open(); fireEvent.click(within(dialog).getByRole("button", { name: "Use Snapshot", exact: true }));
  await waitFor(() => expect(uploads).toHaveLength(1)); await act(async () => finishUpload(false));
  expect(dialog).toBeInTheDocument(); expect(within(dialog).getByRole("status")).toHaveTextContent("could not be inserted");
  expect(session.settings.selectedSources).toEqual(["old"]); expect(session.assets).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Use Snapshot", exact: true }));
  await waitFor(() => expect(uploads).toHaveLength(2)); await act(async () => finishUpload());
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
it("canceling the picker leaves the draft untouched", async () => {
  const dialog = await open(); fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(uploads).toHaveLength(0); expect(session.settings.selectedSources).toEqual(["old"]);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:video");
});
it("does not offer an image reference in text-only mode", async () => {
  session.settings.mode = "text"; render(<H3NsfwStudio />); await screen.findByLabelText("Your scene");
  expect(screen.queryByRole("button", { name: "Snapshot", exact: true })).not.toBeInTheDocument();
});
