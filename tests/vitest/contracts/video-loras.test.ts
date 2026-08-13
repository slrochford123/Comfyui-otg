import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VIDEO_LORA_PATCH_POINTS,
  VideoLoraCompatibilityError,
  applyVideoLoras,
  assertVideoLorasInstalled,
  detectVideoWorkflowFamily,
  loadVideoLoraCatalog,
  resolveVideoLoraSelections,
  validateVideoLoraCatalog,
  type VideoLoraCatalog,
  type VideoLoraCatalogEntry,
  type ValidatedVideoLora,
} from "@/lib/videoLoras";
import { normalizeVideoLoraInventory } from "@/lib/videoLoraInventory";

const root = process.cwd();

function graph(workflowId: string) {
  const value = JSON.parse(fs.readFileSync(path.join(root, "comfy_workflows", `${workflowId}.json`), "utf8"));
  delete value.__otg;
  return value;
}

function wanEntry(workflowId: string): VideoLoraCatalogEntry {
  return {
    id: "wan-test-style",
    displayName: "Verified Wan Test Style",
    filename: "verified-wan-test-style.safetensors",
    aliases: [],
    family: "wan",
    baseModelVariant: "Wan 2.2 high/low",
    supportedWorkflowIds: [workflowId],
    supportedModes: [VIDEO_LORA_PATCH_POINTS[workflowId].mode],
    description: "Administrator-mapped deterministic test fixture.",
    triggerWords: [],
    recommendedStrength: 0.75,
    minimumStrength: 0,
    maximumStrength: 2,
    defaultHighNoiseStrength: 0.75,
    defaultLowNoiseStrength: 0.75,
    promptExample: "A deterministic Wan fixture prompt.",
    dependencies: ["Wan 2.2"],
    limitations: ["Test fixture only."],
    license: "Test fixture license statement.",
    commercialUse: "test-only",
    catalogStatus: "active",
    sortOrder: 1,
  };
}

function wanSelection(workflowId: string, overrides: Partial<ValidatedVideoLora> = {}): ValidatedVideoLora {
  const entry = wanEntry(workflowId);
  return { id: entry.id, strength: 0.75, entry, ...overrides };
}

describe("video LoRA catalog and request validation", () => {
  it("validates the source-controlled schema and keeps incomplete metadata unselectable", () => {
    const catalog = loadVideoLoraCatalog();
    expect(validateVideoLoraCatalog(catalog)).toBe(catalog);
    expect(catalog.entries).toHaveLength(7);
    expect(catalog.entries.filter((entry) => entry.catalogStatus === "active").map((entry) => entry.id)).toEqual([
      "ltx23-omnicine-v1",
      "ltx23-cinematic-hard-cut",
      "ltx23-camera-controls",
      "ltx23-retro-90s-anime",
      "ltx23-fantasy-realism",
      "ltx23-premium-cgi-toon",
    ]);
    expect(catalog.entries.find((entry) => entry.id === "ltx23-camera-controls")?.commercialUse).toBe("not_allowed");
  });

  it("normalizes inventory without guessing a family from filenames", () => {
    const items = normalizeVideoLoraInventory("rtx3090", [
      "Singularity-LTX-2.3_OmniCine_V1.safetensors",
      "WAN-looking-but-uncurated.safetensors",
      "Singularity-LTX-2.3_OmniCine_V1.safetensors",
    ], "/models/loras", "2026-07-19T00:00:00.000Z");
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.exactFilename.startsWith("Singularity"))?.inferredFamily).toBe("ltx");
    expect(items.find((item) => item.exactFilename.startsWith("WAN-looking"))?.inferredFamily).toBeNull();
    expect(items.every((item) => item.sourceEndpoint === "/models/loras" && item.available)).toBe(true);
  });

  it.each([
    ["presets/Create a Video", "ltx"],
    ["presets/WAN 2.2 T2V GGUF", "wan"],
    ["presets/Create a Picture", null],
  ])("detects workflow family for %s", (workflowId, expected) => {
    expect(detectVideoWorkflowFamily(workflowId)).toBe(expected);
  });

  it("enforces maximum two and duplicate rejection", () => {
    const valid = { id: "ltx23-omnicine-v1", strength: 0.8 };
    expect(() => resolveVideoLoraSelections([valid, valid, valid], "presets/Create a Video")).toThrow("no more than two");
    expect(() => resolveVideoLoraSelections([valid, valid], "presets/Create a Video")).toThrow("Duplicate");
  });

  it("rejects unknown IDs and path traversal before catalog lookup", () => {
    expect(() => resolveVideoLoraSelections([{ id: "unknown", strength: 1 }], "presets/Create a Video")).toThrow("Unknown");
    expect(() => resolveVideoLoraSelections([{ id: "../OmniCine.safetensors", strength: 1 }], "presets/Create a Video")).toThrow("path separators");
  });

  it("rejects metadata-pending, family-mismatched, and unsupported-mode entries", () => {
    expect(() => resolveVideoLoraSelections([{ id: "ltx23-obscura-remova", strength: 1 }], "presets/Create a Video")).toThrow("not selectable");
    expect(() => resolveVideoLoraSelections([{ id: "ltx23-omnicine-v1", strength: 0.8 }], "presets/WAN 2.2 T2V GGUF")).toThrow("not WAN");
    expect(() => resolveVideoLoraSelections([{ id: "ltx23-cinematic-hard-cut", strength: 0.2 }], "presets/Create First Image to Last Image Video")).toThrow("not compatible");
  });

  it("returns a precise missing-backend-LoRA conflict", () => {
    const selections = resolveVideoLoraSelections([{ id: "ltx23-omnicine-v1", strength: 0.8 }], "presets/Create a Video");
    try {
      assertVideoLorasInstalled(selections, [], "RTX 5060 Ti");
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(VideoLoraCompatibilityError);
      expect((error as VideoLoraCompatibilityError).status).toBe(409);
      expect((error as Error).message).toContain("RTX 5060 Ti cannot run this request");
    }
  });

  it("rejects an active catalog entry with missing tutorial metadata", () => {
    const original = loadVideoLoraCatalog();
    const broken: VideoLoraCatalog = JSON.parse(JSON.stringify(original));
    broken.entries[0].description = "";
    expect(() => validateVideoLoraCatalog(broken)).toThrow("description");
  });
});

describe("explicit immutable video workflow patching", () => {
  it("leaves an unselected graph graph-equivalent and does not add placeholders", () => {
    const original = graph("presets/Create a Video");
    const serialized = JSON.stringify(original);
    const result = applyVideoLoras(original, "presets/Create a Video", []);
    expect(result.graph).toEqual(original);
    expect(result.graph).not.toBe(original);
    expect(JSON.stringify(original)).toBe(serialized);
    expect(Object.values(result.graph).some((node: any) => String(node?.inputs?.lora_name || "").includes("__otg"))).toBe(false);
  });

  it.each([
    "presets/WAN 2.2 T2V GGUF",
    "presets/WAN 2.2 T2V SafeTensor",
    "presets/WAN 2.2 I2V GGUF",
    "presets/WAN 2.2 I2V SafeTensor",
    "presets/WAN 2.2 FLF GGUF",
    "presets/WAN 2.2 FLF SafeTensor",
  ])("injects both high/low branches for %s and preserves internal LoRAs", (workflowId) => {
    const original = graph(workflowId);
    const definition = VIDEO_LORA_PATCH_POINTS[workflowId];
    const internalBefore = definition.requiredInternalLoras.map(({ nodeId }) => JSON.parse(JSON.stringify(original[nodeId])));
    const result = applyVideoLoras(original, workflowId, [wanSelection(workflowId)]);
    for (const branch of definition.branches) {
      const ref = result.graph[branch.targetNodeId].inputs[branch.targetInput];
      const inserted = result.graph[ref[0]];
      expect(inserted.class_type).toBe("LoraLoaderModelOnly");
      expect(inserted.inputs.model).toEqual([branch.sourceNodeId, 0]);
      expect(inserted.inputs.lora_name).toBe("verified-wan-test-style.safetensors");
    }
    expect(definition.requiredInternalLoras.map(({ nodeId }) => result.graph[nodeId])).toEqual(internalBefore);
    expect(original).toEqual(graph(workflowId));
  });

  it("applies separate Wan high/low strengths", () => {
    const workflowId = "presets/WAN 2.2 T2V SafeTensor";
    const result = applyVideoLoras(graph(workflowId), workflowId, [wanSelection(workflowId, { highNoiseStrength: 1.2, lowNoiseStrength: 0.4 })]);
    const highRef = result.graph["122"].inputs.model[0];
    const lowRef = result.graph["101"].inputs.model[0];
    expect(result.graph[highRef].inputs.strength_model).toBe(1.2);
    expect(result.graph[lowRef].inputs.strength_model).toBe(0.4);
  });

  it.each([
    "presets/Create a Video",
    "presets/Create a Video from Images",
    "presets/Create First Image to Last Image Video",
  ])("injects the shared LTX base/refinement model path for %s", (workflowId) => {
    const original = graph(workflowId);
    const internal287 = JSON.parse(JSON.stringify(original["287"]));
    const internal453 = JSON.parse(JSON.stringify(original["453"]));
    const selection = resolveVideoLoraSelections([{ id: "ltx23-omnicine-v1", strength: 0.8 }], workflowId);
    const result = applyVideoLoras(original, workflowId, selection);
    const insertedId = result.graph["358"].inputs.any_02[0];
    expect(result.graph[insertedId]).toMatchObject({
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["287", 0], lora_name: "Singularity-LTX-2.3_OmniCine_V1.safetensors", strength_model: 0.8 },
    });
    expect(result.graph["468"].inputs).toEqual(original["468"].inputs);
    expect(result.graph["459"].inputs).toEqual(original["459"].inputs);
    expect(result.graph["102"].inputs.model).toEqual(["459", 0]);
    expect(result.graph["138"].inputs.model).toEqual(["468", 0]);
    expect(result.graph["287"]).toEqual(internal287);
    expect(result.graph["453"]).toEqual(internal453);
    expect(result.graph["827"]).toEqual(original["827"]);
  });

  it("chains a two-LoRA LTX stack with unique IDs", () => {
    const workflowId = "presets/Create a Video";
    const selection = resolveVideoLoraSelections([
      { id: "ltx23-omnicine-v1", strength: 0.8 },
      { id: "ltx23-cinematic-hard-cut", strength: 0.2 },
    ], workflowId);
    const result = applyVideoLoras(graph(workflowId), workflowId, selection);
    const tailId = result.graph["358"].inputs.any_02[0];
    const firstId = result.graph[tailId].inputs.model[0];
    expect(tailId).not.toBe(firstId);
    expect(result.graph[firstId].inputs.model).toEqual(["287", 0]);
  });

  it("fails closed before mutation when a declared patch point changes", () => {
    const original = graph("presets/WAN 2.2 T2V GGUF");
    original["122"].inputs.model = ["104", 0];
    const serialized = JSON.stringify(original);
    expect(() => applyVideoLoras(original, "presets/WAN 2.2 T2V GGUF", [wanSelection("presets/WAN 2.2 T2V GGUF")])).toThrow("failed closed");
    expect(JSON.stringify(original)).toBe(serialized);
  });
});

describe("route integration contracts", () => {
  const routeSource = fs.readFileSync(path.join(root, "app/api/comfy/route.ts"), "utf8");
  const pageSource = fs.readFileSync(path.join(root, "app/app/AppPageClient.tsx"), "utf8");

  it("submits only catalog IDs and strengths in the selected payload", () => {
    expect(pageSource).toContain('body.set("videoLoras", JSON.stringify(selectedVideoLoras.slice(0, 2)))');
    expect(routeSource).toContain("resolveVideoLoraSelections");
    expect(routeSource).toContain("applyVideoLoras");
  });

  it("records Video LoRAs in request metadata and sanitized logs", () => {
    expect(routeSource).toContain("videoLoras: publicVideoLoraSelectionMetadata(validatedVideoLoras)");
    expect(routeSource).toContain("videoLorasApplied: videoLoraRes?.applied ?? []");
    expect(routeSource).not.toContain("videoLoras: validatedVideoLoras");
  });

  it("retains ambiguous no-retry and single-fallback submission contracts", () => {
    expect(routeSource).toContain("automatic fallback was not attempted to prevent duplicate generation");
    expect(routeSource).toContain("fallback_submission_ambiguous_no_retry");
    expect(routeSource).toContain("No prompt is submitted by this step.");
  });
});
