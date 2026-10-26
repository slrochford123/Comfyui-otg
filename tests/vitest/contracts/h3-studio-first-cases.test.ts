import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareFirstCases, prepareFirstCasesCli } from "../../../scripts/h3-studio/qualification-first-cases";
import { h3StudioQualificationRequestDigest } from "@/lib/h3StudioIdentity";
vi.mock("@/lib/h3StudioRuntime", () => ({ inspectStudioQualificationRuntime: vi.fn(() => { throw new Error("No physical inspection during local planning."); }) }));
let temporary: string;
beforeEach(() => { temporary = fs.mkdtempSync(path.join(os.tmpdir(), "h3-local-cases-unit-")); fs.chmodSync(temporary, 0o700); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(temporary, { recursive: true, force: true }); });
describe("local-only first-case proposals", () => {
  it("creates complete canonical cases, private artifacts, and no qualification or model hashes", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network is forbidden during planning."));
    const models = path.join(temporary, "models"), vae = path.join(models, "vae_approx"); fs.mkdirSync(vae, { recursive: true });
    const modelFile = path.join(vae, "taeh3.safetensors"); fs.writeFileSync(modelFile, "stat-only fixture, not model evidence");
    const read = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: unknown, ...args: unknown[]) => {
      if (file === modelFile) throw new Error("Model files must not be read or hashed during case planning.");
      return (read as (...values: unknown[]) => unknown)(file, ...args);
    }) as typeof fs.readFileSync);
    const result = await prepareFirstCases({ ownerKey: "fixture_owner", researchRoot: temporary, modelsRoots: [models] });
    expect(result.execution).toBe("NONE"); expect(result.modelHashing).toBe("NONE"); expect(network).not.toHaveBeenCalled();
    expect(fs.statSync(result.directory).mode & 0o777).toBe(0o700);
    const proposals = result.proposals.map(file => { expect(fs.statSync(file).mode & 0o777).toBe(0o600); return JSON.parse(read(file, "utf8")); });
    expect(proposals.map(p => [p.plan.workflowId, p.plan.profile, p.plan.quality, p.plan.durationSeconds])).toEqual([
      ["native-t2v", "native", "0.2", 5], ["native-r2v", "ref2va-8step", "0.2", 5],
    ]);
    for (const p of proposals) {
      expect(p.requestDigest).toBe(h3StudioQualificationRequestDigest(p.plan, p.jobInput)); expect(p.evidence.qualifications).toEqual({});
      expect(p.inventory.assets).toEqual({}); expect(p.evidence.assets).toEqual({}); expect(p.inventory.nodes).toEqual([]);
      expect(p.assetLocations["taeh3.safetensors"].path).toBe(modelFile); expect(p.assetLocations["taeh3.safetensors"].sha256).toBeUndefined();
      expect(p.requiredVramBytes).toBeNull(); expect(p.evidence.upstreamAuthorization.reference).toContain("no written license reviewed");
      expect(Object.keys(p.assetRights).length).toBeGreaterThan(0);
      for (const rights of Object.values(p.assetRights)) expect(rights).toMatchObject({ status: "OWNER_REVIEW_REQUIRED", reference: "" });
    }
    const r2v = proposals[1]; expect(r2v.jobInput.images).toHaveLength(1); expect(r2v.compilerInput.references).toHaveLength(1);
    expect(r2v.compilerInput.finalPrompt).toContain("<Picture 1>"); expect(r2v.compilerInput.finalPrompt).toContain("<Subject 1>");
    expect(r2v.compilerInput.references[0].uploadedFilename).toBeTruthy();
    expect(r2v.assetRights["fasth3_omniref_8step_pruned_int8_convrot.safetensors"]).toBeUndefined();
    expect(r2v.assetRights["minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors"]).toMatchObject({ status: "OWNER_REVIEW_REQUIRED", reference: "" });
    expect(fs.statSync(result.syntheticQaImage).mode & 0o777).toBe(0o600);
    expect(read(result.syntheticQaImage).subarray(0,8).toString("hex")).toBe("89504e470d0a1a0a");
  });
  it("requires explicit owner/path and rejects execution options", async () => {
    await expect(prepareFirstCasesCli([])).rejects.toThrow(/explicit/);
    await expect(prepareFirstCasesCli(["--execute"])).rejects.toThrow(/No execution/);
    await expect(prepareFirstCases({ ownerKey: "", researchRoot: temporary })).rejects.toThrow(/explicit/);
    fs.chmodSync(temporary, 0o755);
    await expect(prepareFirstCases({ ownerKey: "fixture_owner", researchRoot: temporary })).rejects.toThrow(/mode 700/);
  });
});
