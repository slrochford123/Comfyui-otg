import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareH3StudioQualificationInventory, summarizeH3StudioQualificationTelemetry } from "../../../scripts/h3-studio/qualification-inventory";
import { matchesH3StudioAssetFile, type H3StudioEvidence } from "@/lib/h3StudioRegistry";
const rights = { status: "owner-attested", scope: "private-test", environment: "test", target: "3090", ownerKey: "owner", reference: "Explicit private TEST owner clearance for this individual asset" } as const;
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "h3-receipt-unit-")); });
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
describe("owner hash producer without runtime qualification", () => {
  it("hashes only selected graph files including tiny VAE, captures stats and creates no pass record", () => {
    const file = path.join(directory, "tiny-vae.fixture"); fs.writeFileSync(file, "asset fixture bytes");
    const evidence: H3StudioEvidence = { schemaVersion: 2, environment: "test", target: "3090", upstreamAuthorization: rights, assets: {}, loras: {}, qualifications: {} };
    const prepared = prepareH3StudioQualificationInventory({ graph: { preview: { class_type: "ModelPreviewOverrideKJ", inputs: { tiny_vae: "taeh3.safetensors" } } },
      assetPaths: { "taeh3.safetensors": file, unselected: "/must/not/be/read" }, assetRights: { "taeh3.safetensors": rights }, evidence });
    const asset = prepared.inventory.assets!["taeh3.safetensors"];
    expect(asset.sha256).toBe(crypto.createHash("sha256").update("asset fixture bytes").digest("hex"));
    expect(asset.bytes).toBe(Buffer.byteLength("asset fixture bytes")); expect(Object.keys(prepared.inventory.assets!)).toEqual(["taeh3.safetensors"]);
    expect(prepared.evidence.qualifications).toEqual({}); expect(evidence.assets).toEqual({});
    expect(matchesH3StudioAssetFile(prepared.inventory.assetFiles![asset.filename], asset.bytes)).toBe(true);
    fs.writeFileSync(file, "different but same size"); expect(matchesH3StudioAssetFile(prepared.inventory.assetFiles![asset.filename], asset.bytes)).toBe(false);
  });
  it("does not inherit upstream rights for an adapter", () => {
    const file = path.join(directory, "adapter.fixture"); fs.writeFileSync(file, "fixture");
    const evidence: H3StudioEvidence = { schemaVersion: 2, environment: "test", target: "3090", upstreamAuthorization: rights, assets: {}, loras: {}, qualifications: {} };
    expect(() => prepareH3StudioQualificationInventory({ graph: { adapter: { class_type: "LoraLoaderModelOnly", inputs: { lora_name: "adapter" } } },
      assetPaths: { adapter: file }, assetRights: {}, evidence })).toThrow(/separate rights/);
  });
  it("preserves measured peaks and rejects identity changes without inventing telemetry", () => {
    const sample = { at: "2026-01-01", gpuUuid: "GPU-3090", gpuName: "RTX 3090", totalVramBytes: 24, usedVramBytes: 16, totalRamBytes: 100, usedRamBytes: 40, usedSwapBytes: 0 };
    const telemetry = summarizeH3StudioQualificationTelemetry([sample, { ...sample, at: "2026-01-02", usedVramBytes: 20, usedRamBytes: 60, usedSwapBytes: 3 }]);
    expect([telemetry.peakVramBytes, telemetry.peakRamBytes, telemetry.peakSwapBytes]).toEqual([20, 60, 3]);
    expect(() => summarizeH3StudioQualificationTelemetry([sample, { ...sample, gpuUuid: "OTHER" }])).toThrow(/Consistent/);
    expect(() => summarizeH3StudioQualificationTelemetry([sample])).toThrow();
  });
});
