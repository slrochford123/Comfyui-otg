import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const auth = vi.hoisted(() => ({ ok: false, status: 403, error: "Not authorized" }));
vi.mock("@/app/api/admin/_requireAdmin", () => ({ requireAdmin: async () => auth }));
import { proxyOwnedWorkerMedia } from "@/lib/comfyMediaAccess";
beforeEach(() => { vi.stubEnv("OTG_ENV", "test"); vi.stubGlobal("fetch", vi.fn(() => { throw Error("Must not fetch restricted output"); })); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("the ordinary worker-media proxy cannot expose experimental output after admin revocation", async () => {
  await expect(proxyOwnedWorkerMedia(new NextRequest("http://test.local/api/comfy/view"), "http://worker", { filename: "result.mp4", subfolder: "refmod_lab/test-id", type: "output" })).rejects.toThrow("Not authorized");
  expect(fetch).not.toHaveBeenCalled();
});
it("experimental output stays inaccessible through generic proxies in PROD", async () => {
  vi.stubEnv("OTG_ENV", "prod");
  await expect(proxyOwnedWorkerMedia(new NextRequest("http://test.local/api/comfy/view"), "http://worker", { filename: "result.mp4", subfolder: "refmod_lab/test-id", type: "output" })).rejects.toThrow("Media not found");
  expect(fetch).not.toHaveBeenCalled();
});
