import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ owner: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/ownerKey", () => ({ getOwnerContext: mocks.owner, SessionInvalidError: class extends Error {} }));
vi.mock("@/lib/workers/comfyPromptLease", () => ({ submitComfyPromptWith5060Lease: mocks.submit }));
vi.mock("@/lib/images/mediaGpuBackend", () => ({ chooseMediaImageBackend: vi.fn().mockResolvedValue({
  baseUrl: "http://100.75.162.64:8188", label: "local-3090", fallbackUsed: false,
}) }));

it("registers the worker preview for its owner and replays without resubmission", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-preview-"));
  vi.stubEnv("OTG_DATA_DIR", root);
  vi.stubEnv("OTG_DATA_ROOT", root);
  vi.stubEnv("OTG_CHARACTER_CREATE_REQUEST_STORE", path.join(root, "requests"));
  const promptId = "character-prompt-qa";
  const worker = "http://100.75.162.64:8188";
  const origin = "http://localhost:3001";
  const history = { [promptId]: { outputs: { "73": { images: [{ filename: "preview.png", type: "temp", subfolder: "" }] } } } };
  const fetcher = vi.fn(async (url: string | URL) => {
    if (String(url) === worker + "/history/" + promptId) return Response.json(history);
    if (String(url).startsWith(worker + "/view?")) return new Response("preview bytes", { headers: { "Content-Type": "image/png" } });
    throw new Error("Unexpected worker URL: " + url);
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    const { POST } = await import("@/app/api/characters/create-image/route");
    const { GET } = await import("@/app/api/comfy/history-image/route");
    const { promptRequestMetaPath } = await import("@/lib/promptRequestMeta");
    mocks.owner.mockResolvedValue({ ownerKey: "owner_a", username: "owner_a" });
    mocks.submit.mockResolvedValue(Response.json({ prompt_id: promptId }));
    const request = () => new NextRequest(origin + "/api/characters/create-image", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientRequestId: "character-request-qa", model: "ernie-image", style: "cinematic", mode: "standard", description: "A traveler" }),
    });
    expect((await POST(request())).status).toBe(200);
    const graph = JSON.parse(mocks.submit.mock.calls[0][0].init.body).prompt;
    expect(graph["73"].inputs.images).toEqual(["900001", 0]);
    expect(graph["900001"].inputs).toMatchObject({ width: 1080, height: 1920, image: ["88:65", 0] });
    const lookup = new NextRequest(origin + "/api/comfy/history-image?nodeId=73&promptId=" + promptId);
    const own = await GET(lookup);
    expect(own.status).toBe(200);
    const { imageUrl } = await own.json();
    expect(await (await GET(new NextRequest(origin + imageUrl))).text()).toBe("preview bytes");
    mocks.owner.mockResolvedValue({ ownerKey: "owner_b" });
    fetcher.mockClear();
    expect((await GET(lookup)).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();

    mocks.owner.mockResolvedValue({ ownerKey: "owner_a" });
    fs.unlinkSync(promptRequestMetaPath("owner_a", promptId));
    expect(await (await POST(request())).json()).toMatchObject({ promptId });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect((await GET(lookup)).status).toBe(200);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
