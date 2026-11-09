import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ choice: vi.fn(), submit: vi.fn(), job: vi.fn() }));
vi.mock("@/lib/ownerKey", () => ({ getOwnerContext: async () => ({ ownerKey: "qa_owner" }), SessionInvalidError: class extends Error {} }));
vi.mock("@/lib/mediaGpuRoutingServer", () => ({ mediaGpuRoutingEnabled: () => true, requestedMediaGpu: mock.choice }));
vi.mock("@/lib/workers/mediaGpuQueue", () => ({ getMediaQueueJob: mock.job }));
vi.mock("@/lib/workers/comfyPromptLease", () => ({ submitComfyPromptWith5060Lease: mock.submit }));
const base = "http://100.75.162.64:8188";
function request() {
  const form = new FormData();
  form.set("image", new File(["fixture"], "source.png", {type:"image/png"}));
  return new NextRequest("http://localhost:3001/api/background-remove", {method:"POST", body:form});
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("rejects a manually selected unqualified 5060 before worker I/O", async () => {
  vi.stubEnv("OTG_MEDIA_3090_IMAGE_URL", base);
  mock.choice.mockResolvedValue("rtx5060ti");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { POST } = await import("@/app/api/background-remove/route");
  const res = await POST(request());
  expect(res.status).toBe(422);
  expect(await res.json()).toMatchObject({stage:"select_worker"});
  expect(fetcher).not.toHaveBeenCalled();
  expect(mock.submit).not.toHaveBeenCalled();
});
it("submits Automatic background removal on the configured 3090 and reports a failed queued job", async () => {
  vi.stubEnv("OTG_MEDIA_3090_IMAGE_URL", base);
  mock.choice.mockResolvedValue("auto");
  mock.submit.mockResolvedValue(Response.json({prompt_id:"background-qa"}, {status:202}));
  mock.job.mockReturnValue({status:"failed"});
  const fetcher = vi.fn().mockResolvedValue(Response.json({name:"source.png"}));
  vi.stubGlobal("fetch", fetcher);
  const { POST } = await import("@/app/api/background-remove/route");
  const res = await POST(request());
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(base+"/upload/image");
  expect(mock.submit.mock.calls[0][0]).toMatchObject({baseUrl:base,workerId:"api-background-remove"});
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({stage:"poll_history",error:expect.stringContaining("Your source image is saved")});
});
