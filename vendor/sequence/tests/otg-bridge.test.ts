import { afterEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  exportChanged: () => {},
  job: { id: "", status: "idle", blob: undefined as Blob | undefined },
  project: { assets: [] },
}));
vi.mock("../src/core/store", () => ({ store: {
  get: () => ({ project: fake.project }),
  replace: vi.fn(), clearHistory: vi.fn(), patch: vi.fn(), subscribe: vi.fn(),
} }));
vi.mock("../src/core/model", () => ({ emptyProject: () => fake.project, validateProject: (p: unknown) => p }));
vi.mock("../src/engine/client", () => ({ assetFiles: new Map() }));
vi.mock("../src/core/actions", () => ({ importFiles: vi.fn(), relinkAsset: vi.fn() }));
vi.mock("../src/engine/export", () => ({ exports: {
  get: () => fake.job,
  subscribe: (listener: () => void) => { fake.exportChanged = listener; },
} }));
afterEach(() => vi.unstubAllGlobals());

it("keeps project switching locked until the encoded export upload finishes", async () => {
  const postMessage = vi.fn();
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  vi.stubGlobal("parent", { postMessage });
  vi.stubGlobal("location", { search: "?project=dd13f9f5-f0aa-40d0-8791-1c17a8bdbe00", origin: "https://test.example" });
  let finishUpload!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ ok: true, project: { revision: 0, name: "Test", state: null } }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishUpload = resolve; })));
  const { startOtgBridge } = await import("../src/otg-bridge");
  await startOtgBridge();
  postMessage.mockClear();
  fake.job = { id: "export-one", status: "complete", blob: new Blob(["video"]) };
  fake.exportChanged();
  fake.exportChanged();
  expect(postMessage.mock.calls.filter(([message]) => message.type === "rendering")
    .every(([message]) => message.active === true)).toBe(true);
  const unload = new Event("beforeunload", { cancelable: true });
  target.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  finishUpload(Response.json({ ok: true, media: { id: "saved", url: "/video" } }));
  await vi.waitFor(() => expect(postMessage).toHaveBeenLastCalledWith(
    { channel: "otg-sequence-v1", type: "rendering", active: false }, "https://test.example"));
  expect(postMessage.mock.calls.some(([message]) => message.type === "export" && message.media.id === "saved")).toBe(true);
});
