import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import installed from "@/lib/h3Stage1cInstalled.json";
import { registeredH3Loras, h3AccelerationLora } from "@/lib/h3RegisteredLoras";
import { fastH3LoraBlockReason } from "@/lib/h3FastLora";
import { buildH3Workflow } from "@/lib/production/h3Workflows";
import { canonicalH3OptionalLoraFilename, mergeH3LoraCatalogScans, publicH3LoraCatalog, readH3LoraCatalog } from "@/lib/h3LoraCatalogServer";
import { DEFAULT_H3_STUDIO_PLAN, reconcileH3StudioPlan } from "@/lib/h3StudioPlan";
import { h3StudioCatalog } from "@/lib/h3StudioRegistry";
import { compileH3StudioPlan, h3StudioPreviewInput } from "@/lib/h3StudioCompiler";

const styles = registeredH3Loras.filter(entry => !h3AccelerationLora(entry));
const profiles = [
  { checkpointMode: "standard", renderMode: "native" }, { checkpointMode: "standard", renderMode: "turbo" },
  { checkpointMode: "singularity", renderMode: "native" }, { checkpointMode: "singularity", renderMode: "turbo" },
  { checkpointMode: "fasth3", renderMode: "turbo" }, { checkpointMode: "selflift", renderMode: "turbo" },
] as const;
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("shared H3 adapters across model choices and GPUs", () => {
  it("registers 66 style/motion identities without merging acceleration profiles into styles", () => {
    expect(styles).toHaveLength(66);
    expect(new Set(styles.map(e => e.sha256)).size).toBe(66);
    for (const entry of styles) expect(fastH3LoraBlockReason(entry.filename, entry.defaultStrength)).toBeNull();
    for (const entry of installed.entries.filter(h3AccelerationLora)) expect(fastH3LoraBlockReason(entry.filename)).toMatch(/acceleration/);
    expect(fastH3LoraBlockReason("../unknown.safetensors")).toMatch(/exact installed/);
  });
  it.each(["rtx3090", "rtx5060ti"] as const)("compiles every style through all six rendering profiles on %s", backend => {
    for (const entry of styles) for (const h3Settings of profiles) {
      const { graph } = buildH3Workflow({ backend, mode: "h3-reference-to-video", h3Quality: "sh", durationSeconds: 5,
        finalPrompt: "<Picture 1> is <Subject 1>. A dragon flies.", seed: 42, outputPrefix: "fixture/all-model-loras", h3Settings,
        references: [{ id: "dragon", name: "Dragon", sourceKind: "production-upload", pictureSlot: 1, subjectSlot: 1, workflowImage: "dragon.png", uploadedFilename: "dragon.png" }],
        optionalLoras: [{ id: "fixture", label: entry.displayName, filename: entry.filename, strength: entry.defaultStrength, triggerWords: entry.triggerWords }] });
      expect(graph["70"].inputs.lora_name).toBe(entry.filename);
      expect(graph["70"].inputs.strength_model).toBe(entry.defaultStrength);
      expect(graph["38"].inputs.model).toEqual(["70", 0]);
      expect(graph["24"].inputs.steps).toBe(h3Settings.renderMode === "native" ? 20 : 8);
      if (h3Settings.checkpointMode === "selflift") expect(graph["21"].inputs.model).toEqual(["164", 0]);
      for (const trigger of entry.triggerWords) expect(graph["39"].inputs.prompt.toLowerCase()).toContain(trigger.toLowerCase());
    }
  });
  it("discovers registered top-level names on both workers without admitting arbitrary root files", () => {
    for (const file of ["H3_Combat_V2.safetensors", "GL_H3_V1-step00017250.safetensors", "Motion_Repair.safetensors", "Motion_Repair_V2.safetensors", "h3-realism-people-t2v-i2v-r2v.safetensors"]) {
      expect(canonicalH3OptionalLoraFilename(file)).toBe(file);
    }
    for (const file of ["unregistered.safetensors", "../H3_Combat_V2.safetensors", "/H3_Combat_V2.safetensors", "MiniMax-H3/Acceleration/turbo.safetensors"]) expect(canonicalH3OptionalLoraFilename(file)).toBeNull();
    vi.stubEnv("OTG_ENV", "prod"); vi.stubEnv("OTG_H3_LORA_CATALOG_FILE", "/nonexistent/fixture-h3-catalog");
    const catalog = readH3LoraCatalog(), files = new Set(styles.map(e => e.filename));
    const scanned = mergeH3LoraCatalogScans(catalog, (["rtx3090", "rtx5060ti"] as const).map(backend => ({ backend, ok: true, error: "", files })));
    for (const file of files) expect(scanned.find(e => e.filename === file)?.discoveredOn).toEqual(["rtx3090", "rtx5060ti"]);
  });
  it("retains explicit Admin disable choices and filters by the selected GPU", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "h3-lora-policy-")); roots.push(root);
    const file = path.join(root, "catalog.json");
    vi.stubEnv("OTG_H3_LORA_CATALOG_FILE", file); vi.stubEnv("OTG_ENV", "prod");
    const before = readH3LoraCatalog(); const entry = before.entries.find(e => e.id === "combat")!;
    fs.writeFileSync(file, JSON.stringify({ ...before, entries: [{ ...entry, enabled: false, discoveredOn: ["rtx3090"] }] }));
    expect(readH3LoraCatalog().entries.find(e => e.id === "combat")?.enabled).toBe(false);
    expect(publicH3LoraCatalog("h3-reference-to-video", "rtx5060ti").entries.find(e => e.id === "combat")).toBeUndefined();
  });
  it.each(["rtx3090", "rtx5060ti"] as const)("uses registered non-Civitai IDs in Studio without inventing upstream version IDs on %s", backend => {
    vi.stubEnv("OTG_ENV", "prod"); vi.stubEnv("OTG_H3_LORA_CATALOG_FILE", "/nonexistent/fixture-h3-catalog");
    const entry = installed.additionalInstalled.find(e => e.id === "combat")!;
    const plan = reconcileH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, backend, workflowId: "native-r2v", prompt: "A dragon flies", originalPrompt: "A dragon flies",
      loras: [{ id: entry.id, strength: .7, enabled: true }] }, { checkpoint: "selflift" });
    const inventory = { backend, nodes: new Set<string>(), models: new Set<string>(), loras: new Set([entry.filename]), observedAt: "" };
    const catalog = h3StudioCatalog(inventory, null);
    expect(catalog.find(e => e.id === entry.id)).toMatchObject({ modelId: null, versionId: null, filename: entry.filename, rights: "unresolved" });
    const result = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, null);
    expect(result.graph["70"].inputs.lora_name).toBe(entry.filename);
    expect(result.graph["39"].inputs.prompt).toContain("prfight2");
    expect(() => reconcileH3StudioPlan(plan, { loras: [{ id: "not-registered", strength: 1, enabled: true }] })).toThrow();
  });
  it.each(["rtx3090", "rtx5060ti"] as const)("keeps all 66 adapters connected through the shared Studio compiler on %s", backend => {
    vi.stubEnv("OTG_ENV", "prod"); vi.stubEnv("OTG_H3_LORA_CATALOG_FILE", "/nonexistent/fixture-all-styles");
    const inventory = { backend, nodes: new Set<string>(), models: new Set<string>(), loras: new Set(styles.map(e => e.filename)), observedAt: "" };
    for (const entry of styles) for (const profile of profiles) {
      const stage = installed.entries.find(e => e.filename === entry.filename);
      const id = entry.id || `civitai-${stage!.modelId}-${stage!.versionId}`;
      const plan = reconcileH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, backend, workflowId: "native-r2v", prompt: "A dragon flies", originalPrompt: "A dragon flies",
        loras: [{ id, strength: entry.defaultStrength, enabled: true }] },
        { checkpoint: profile.checkpointMode, profile: profile.renderMode === "native" ? "native" : "ref2va-8step" });
      const result = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, null);
      expect(result.graph["70"].inputs.lora_name).toBe(entry.filename);
      expect(result.graph["38"].inputs.model).toEqual(["70", 0]);
    }
  });
  it("accepts actual owner-attested TEST asset provenance for additional adapters without fabricating qualification", () => {
    vi.stubEnv("OTG_ENV", "test"); vi.stubEnv("OTG_H3_LORA_CATALOG_FILE", "/nonexistent/fixture-test-provenance");
    const entry = installed.additionalInstalled.find(e => e.id === "combat")!;
    const rights = { status: "owner-attested" as const, scope: "private-test" as const, environment: "test" as const, target: "3090" as const, ownerKey: "fixture-owner", reference: "Owner fixture; no independent license verification" };
    const evidence = { schemaVersion: 2 as const, environment: "test" as const, target: "3090" as const, upstreamAuthorization: rights,
      assets: { [entry.filename]: { filename: entry.filename, sha256: entry.sha256, bytes: entry.bytes, rights } }, loras: {}, qualifications: {} };
    const inventory = { nodes: new Set<string>(), models: new Set<string>(), loras: new Set([entry.filename]), observedAt: "" };
    const item = h3StudioCatalog(inventory, evidence).find(e => e.id === entry.id)!;
    expect(item.blockedReasons).toEqual([]); expect(item.rights).toBe("owner-attested"); expect(item.runtime).toBe("unverified");
    expect(evidence.qualifications).toEqual({});
  });
  it("retains author-registered signed slider strengths in TEST instead of rejecting them as generic 0–2 adapters", () => {
    vi.stubEnv("OTG_ENV", "test"); vi.stubEnv("OTG_H3_LORA_CATALOG_FILE", "/nonexistent/fixture-slider-provenance");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "h3-slider-policy-")); roots.push(root);
    const file = path.join(root, "catalog.json"); vi.stubEnv("OTG_H3_LORA_CATALOG_FILE", file);
    const entry = installed.entries.find(e => e.versionId === 3389300)!;
    fs.writeFileSync(file, JSON.stringify({ version: 1, updatedAt: "fixture", maxSelections: 3, entries: [{
      id: "slider", filename: entry.filename, displayName: entry.displayName, enabled: true, approvedForH3: true,
      approvedForT2V: true, approvedForI2V: true, approvedForR2V: true, compatibilityStatus: "approved",
      minStrength: entry.minStrength, maxStrength: entry.maxStrength, discoveredOn: ["rtx3090"],
    }] }));
    const rights = { status: "owner-attested" as const, scope: "private-test" as const, environment: "test" as const, target: "3090" as const, ownerKey: "fixture-owner", reference: "Owner fixture" };
    const id = `civitai-${entry.modelId}-${entry.versionId}`;
    const evidence = { schemaVersion: 2 as const, environment: "test" as const, target: "3090" as const, upstreamAuthorization: rights, assets: {}, qualifications: {},
      loras: { [id]: { filename: entry.filename, sha256: entry.sha256, bytes: entry.bytes, rights, family: "both" as const, minStrength: entry.minStrength, maxStrength: entry.maxStrength } } };
    const item = h3StudioCatalog({ nodes: new Set<string>(), models: new Set<string>(), loras: new Set([entry.filename]), observedAt: "" }, evidence).find(e => e.id === id)!;
    expect(item.strength).toEqual({ min: -8, max: 8 }); expect(item.blockedReasons).toEqual([]);
  });
});
