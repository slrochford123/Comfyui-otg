import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { automaticH3Plan, DEFAULT_H3_STUDIO_PLAN } from "@/lib/h3StudioPlan";
import { compileH3StudioPlan, h3StudioPreviewInput } from "@/lib/h3StudioCompiler";
import { h3StudioCatalog, readH3StudioEvidence, type H3StudioInventory } from "@/lib/h3StudioRegistry";
import { H3_STUDIO_ASSET_FIELDS } from "@/lib/h3StudioIdentity";
import installed from "@/lib/h3Stage1cInstalled.json";
import { h3StudioOwnerExperimental } from "@/lib/h3StudioExperimental";
import { assertH3PlannerCapabilityIdentity, h3PlannerSchema } from "@/lib/h3StudioPlanner";

const plan = automaticH3Plan({ ...DEFAULT_H3_STUDIO_PLAN, prompt: "A kite over the sea", originalPrompt: "A kite over the sea" });
function inventoryFor(value = plan): H3StudioInventory {
  const empty = { nodes: new Set<string>(), models: new Set<string>(), loras: new Set<string>(), observedAt: new Date().toISOString() };
  const graph = compileH3StudioPlan(value, h3StudioPreviewInput(value), empty, null).graph;
  const files = new Set(Object.values(graph).flatMap(node => H3_STUDIO_ASSET_FIELDS[node.class_type] ? [String(node.inputs[H3_STUDIO_ASSET_FIELDS[node.class_type]])] : []));
  return { ...empty, nodes: new Set(Object.values(graph).map(node => node.class_type)), files,
    models: new Set([String(graph["30"].inputs.unet_name)]), loras: new Set(files),
    device: { gpuName: "NVIDIA GeForce RTX 3090", totalVramBytes: 24 * 1024 ** 3, freeVramBytes: 1, totalRamBytes: 64 * 1024 ** 3, observedAt: new Date().toISOString() } };
}
beforeEach(() => { vi.stubEnv("OTG_ENV", "prod"); vi.stubEnv("OTG_H3_LORA_CATALOG_FILE", "/nonexistent/prod-catalog"); });
afterEach(() => vi.unstubAllEnvs());
describe("ordinary PROD H3 Studio admission, not a TEST permission bypass", () => {
  it.each(["native-t2v", "native-i2v", "native-r2v", "reference-edit"] as const)("compiles %s from the remote worker without TEST proof or a local filesystem mount", workflowId => {
    const p = automaticH3Plan({ ...plan, workflowId }); const inv = inventoryFor(p);
    const result = compileH3StudioPlan(p, h3StudioPreviewInput(p), inv, null);
    expect(result.manifest.executable).toBe(true); expect(result.manifest.blockedReasons).toEqual([]);
    expect(result.manifest.executionBasis).toBe("installed-workflow"); expect(result.manifest.experimental).toBe(false);
    expect(result.manifest.gpu).toBe("rtx3090"); expect(result.graph["24"].inputs.steps).toBe(8);
    if (workflowId === "native-r2v") expect(result.graph["omni_vsa"].inputs.selection).toBe("vsa");
    else expect(result.graph["41"].inputs.enabled).toBe(true);
    expect(result.manifest.estimatedCredits).toBe(0);
  });
  it("never reads TEST evidence or enables TEST experimental permission on PROD", () => {
    vi.stubEnv("OTG_H3_STUDIO_EVIDENCE_FILE", "/etc/shadow");
    expect(readH3StudioEvidence()).toBeNull(); expect(h3StudioOwnerExperimental("owner")).toBe(false);
  });
  it("continues to reject missing exact models and nodes", () => {
    const inv = inventoryFor(); inv.files!.delete([...inv.files!][0]); inv.nodes.delete("H3SLAAttention");
    const result = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inv, null);
    expect(result.manifest.executable).toBe(false); expect(result.manifest.blockedReasons).toContain("WORKFLOW_NODES_MISSING");
    expect(result.manifest.blockedReasons.some(s => s.startsWith("WORKER_MODEL_MISSING:"))).toBe(true);
  });
  it("requires a live 3090 identity and never falls back to the web host", () => {
    const inv = inventoryFor(); inv.device!.gpuName = "RTX 5060 Ti";
    expect(compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inv, null).manifest.executable).toBe(false);
    expect(() => compileH3StudioPlan(plan, { ...h3StudioPreviewInput(plan), backend: "rtx5060ti" }, inv, null)).toThrow(/3090/);
  });
  it("keeps the existing TEST qualification policy unchanged", () => {
    const inv = inventoryFor(); vi.stubEnv("OTG_ENV", "test"); vi.stubEnv("OTG_H3_STUDIO_EXPERIMENTAL_FILE", "");
    const result = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inv, null);
    expect(result.manifest.executable).toBe(false); expect(result.manifest.blockedReasons).toContain("QUALIFICATION_RECORD_REQUIRED");
  });
  it("offers only exact installed canonical styles, not acceleration adapters or denied downloads", () => {
    const inv = inventoryFor(); inv.loras = new Set(installed.entries.map(entry => entry.filename));
    const catalog = h3StudioCatalog(inv, null);
    expect(catalog.filter(entry => !entry.blockedReasons.length)).toHaveLength(53);
    expect(catalog.filter(entry => [3342524, 3280337, 3398426].includes(entry.versionId)).every(entry => entry.blockedReasons.length)).toBe(true);
    const entry = catalog.find(entry => !entry.blockedReasons.length)!; inv.loras.delete(entry.filename!);
    expect(h3StudioCatalog(inv, null).find(current => current.id === entry.id)!.blockedReasons).toContain("EXACT_WORKER_PATH_NOT_LISTED");
  });
  it("permits registered PROD director choices without calling them TEST experimental", () => {
    const capability = { id: "prod-installed", plan, qualificationFingerprint: "a".repeat(64), installedWorkflow: true,
      allowedLoras: [{ id: "civitai-1-2", name: "Registered style", minStrength: 0, maxStrength: 1 }] };
    const selection = { ...plan, camera: "pan", loras: [{ id: "civitai-1-2", strength: .5, enabled: true }] };
    expect(assertH3PlannerCapabilityIdentity(selection, [capability]).installedWorkflow).toBe(true);
    expect(() => assertH3PlannerCapabilityIdentity({ ...selection, loras: [{ id: "civitai-1-999", strength: .5, enabled: true }] }, [capability])).toThrow();
    expect(JSON.stringify(h3PlannerSchema([capability], plan.originalPrompt))).toContain("civitai-1-2");
  });
});
