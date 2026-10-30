import {beforeEach, afterAll, describe, expect, it, vi} from "vitest";
import {NextRequest} from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
const m = vi.hoisted(() => ({backend: vi.fn(), submit: vi.fn()}));
vi.mock("@/lib/ownerKey", () => ({getOwnerContext: vi.fn(async () => ({ownerKey: "qa_owner", username: "qa_owner", scope: "user"})), SessionInvalidError: class extends Error {}}));
vi.mock("@/lib/sessionUser", () => ({requireSessionUser: vi.fn(async () => ({ownerKey: "qa_owner", username: "qa_owner", scope: "user"}))}));
vi.mock("@/lib/images/nativeImageBackend", () => ({chooseNativeImageBackend: m.backend}));
vi.mock("@/lib/workers/comfyPromptLease", () => ({submitComfyPromptWith5060Lease: m.submit}));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-native-creators-"));
vi.stubEnv("OTG_DATA_DIR", root); vi.stubEnv("OTG_ENV", "test");
const creators = {
  characters: (await import("@/app/api/characters/create-image/route")).POST,
  assets: (await import("@/app/api/assets/create-image/route")).POST,
  backgrounds: (await import("@/app/api/backgrounds/create-image/route")).POST,
};
beforeEach(() => {vi.clearAllMocks(); m.backend.mockResolvedValue({baseUrl: "http://100.75.162.64:8189", label: "rtx3090", fallbackUsed: false}); m.submit.mockImplementation(async () => Response.json({prompt_id: randomUUID()}));});
afterAll(async () => {vi.unstubAllEnvs(); await fs.rm(root, {recursive: true, force: true});});
describe("New model integration in existing creator APIs", () => {
  for (const kind of ["characters", "assets", "backgrounds"] as const) {
    it.each(["minimax-h3-image", "fibo2-dev"] as const)(`${kind} executes the exact %s graph and reports its real dimensions`, async model => {
      const request = new NextRequest(`http://localhost:3001/api/${kind}/create-image`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({model, name: "Cafe compass", prompt: "A brass compass", description: "An adult explorer in a teal jacket", style: "photorealistic", mode: "standard", clientRequestId: randomUUID()})});
      const response = await creators[kind](request), result = await response.json();
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(result).toMatchObject({model, outputNodeId: "461", comfyBaseUrl: "http://100.75.162.64:8189"});
      const expectedSize = kind === "characters" ? {width: 768, height: 1344} : kind === "backgrounds" ? {width: 1344, height: 768} : {width: 1024, height: 1024};
      expect(result).toMatchObject(expectedSize);
      const graph = JSON.parse(m.submit.mock.calls[0][0].init.body).prompt;
      if (model === "fibo2-dev") {
        expect(graph["474"].inputs).toMatchObject(expectedSize);
        expect(graph["458"].inputs).toMatchObject({steps: 50, cfg: 5});
      } else {
        expect(graph["46"].inputs).toMatchObject(expectedSize);
        expect(graph["9"].inputs.steps).toBe(30);
      }
      expect(m.backend).toHaveBeenCalledWith(model);
    });
  }
});
