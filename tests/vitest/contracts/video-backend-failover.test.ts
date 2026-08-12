import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyFallbackReductions,
  resolveVideoCompatibility,
  selectVideoBackend,
} from "@/lib/videoBackendFailover";

let fixtureDir = "";

function writeCapabilityFixture(primaryState = "verified", fallbackState = "verified", fallbackReason = "Verified test fixture.") {
  const manifestVersion = "test-manifest-v1";
  const support = (state: string, reason: string) => ({ state, reason, missingNodes: [], missingModels: [], testedConfiguration: null, estimatedOrMeasuredVramGb: null });
  fs.writeFileSync(path.join(fixtureDir, "backends.json"), JSON.stringify({
    manifestVersion,
    policy: { primaryBackendId: "rtx3090", fallbackBackendId: "rtx5060ti", requireVerifiedWorkflow: true },
    backends: [
      { id: "rtx3090", label: "RTX 3090", url: "http://100.75.162.64:8188", gpu: "RTX 3090", vramGb: 24, priority: 1, health: "healthy", availableNodeClassTypes: [], availableModelFilenames: [], supportedWorkflowIds: [], lastVerifiedAt: "2026-07-18T00:00:00Z" },
      { id: "rtx5060ti", label: "RTX 5060 Ti", url: "http://192.168.1.113:8188", gpu: "RTX 5060 Ti", vramGb: 16, priority: 2, health: "healthy", availableNodeClassTypes: [], availableModelFilenames: [], supportedWorkflowIds: [], lastVerifiedAt: "2026-07-18T00:00:00Z" },
    ],
  }));
  fs.writeFileSync(path.join(fixtureDir, "workflows.json"), JSON.stringify({
    manifestVersion,
    workflows: [
      { id: "presets/Create a Video", workflowFile: "presets/Create a Video.json", kind: "video", requiredNodeTypes: [], requiredModels: [], requiredLoras: [], requiredInputAssets: [], expectedInputCount: 0, expectedOutputTypes: ["video"], estimatedOrMeasuredVramGb: null, backendSupport: { rtx3090: support(primaryState, "Primary fixture state."), rtx5060ti: support(fallbackState, fallbackReason) } },
      { id: "presets/Production IA2V Lip Sync", workflowFile: "presets/Production IA2V Lip Sync.json", kind: "video", requiredNodeTypes: [], requiredModels: [], requiredLoras: [], requiredInputAssets: [], expectedInputCount: 0, expectedOutputTypes: ["video"], estimatedOrMeasuredVramGb: null, backendSupport: { rtx3090: support(primaryState, "Primary fixture state."), rtx5060ti: support("unsupported-vram", "Measured VRAM exceeds 16 GB.") } },
    ],
  }));
}

beforeEach(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "otg-comfy-capabilities-"));
  writeCapabilityFixture();
  vi.stubEnv("OTG_COMFY_BACKENDS_FILE", path.join(fixtureDir, "backends.json"));
  vi.stubEnv("OTG_COMFY_WORKFLOW_CAPABILITIES_FILE", path.join(fixtureDir, "workflows.json"));
});

afterEach(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("video backend failover contract", () => {
  it("defaults unknown video workflows to 3090 only", () => {
    expect(resolveVideoCompatibility({ workflowId: "unknown/huge-video-model" }).mode).toBe("3090_only");
  });

  it("classifies the basic LTX workflow without silently reducing it", () => {
    const result = resolveVideoCompatibility({ workflowId: "presets/Create a Video" });
    expect(result.mode).toBe("compatible");
    expect(result.reductions).toBeUndefined();
  });

  it("caps only scalar safe fallback inputs and preserves graph links", () => {
    const graph: Record<string, any> = {
      "1": { class_type: "EmptyLTXVLatentVideo", inputs: { width: 1280, height: 720, length: 121, batch_size: 2 } },
      "2": { class_type: "LinkedNode", inputs: { width: ["1", 0], frames: ["1", 1] } },
    };
    const changed = applyFallbackReductions(graph, { maxWidth: 512, maxHeight: 512, maxFrames: 49, maxBatchSize: 1 });
    expect(graph["1"].inputs).toEqual({ width: 512, height: 512, length: 49, batch_size: 1 });
    expect(graph["2"].inputs).toEqual({ width: ["1", 0], frames: ["1", 1] });
    expect(changed).toContain("1.length");
  });

  it("uses the verified 3090 when its health check succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toContain("100.75.162.64:8188/system_stats");
      return new Response(JSON.stringify({ devices: [{ name: "NVIDIA GeForce RTX 3090" }] }), { status: 200 });
    }));
    const selected = await selectVideoBackend({ workflowId: "presets/Create a Video" });
    expect(selected.ok).toBe(true);
    if (selected.ok) expect(selected.backend.id).toBe("rtx3090");
  });

  it("includes every selected user LoRA in backend compatibility", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("100.75.162.64")) return new Response(JSON.stringify({ devices: [{ name: "NVIDIA GeForce RTX 3090" }] }), { status: 200 });
      throw new Error("fallback must not be submitted");
    }));
    const selected = await selectVideoBackend(
      { workflowId: "presets/Create a Video" },
      undefined,
      {
        selectedLoras: [{ id: "style-x", displayName: "Style X", filename: "style-x.safetensors" }],
        installedByBackend: { rtx3090: [], rtx5060ti: [] },
      }
    );
    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.status).toBe(409);
      expect(selected.error).toBe("RTX 5060 Ti cannot run this request because LoRA Style X is not installed.");
    }
  });

  it("returns 409 when the primary is missing a selected LoRA and fallback is unavailable", async () => {
    writeCapabilityFixture("verified", "missing-model", "Missing model files: internal-ltx.safetensors");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ devices: [{ name: "NVIDIA GeForce RTX 3090" }] }), { status: 200 })));
    const selected = await selectVideoBackend(
      { workflowId: "presets/Create a Video" },
      undefined,
      {
        selectedLoras: [{ id: "style-x", displayName: "Style X", filename: "style-x.safetensors" }],
        installedByBackend: { rtx3090: [], rtx5060ti: [] },
      }
    );
    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.status).toBe(409);
      expect(selected.error).toContain("RTX 3090 cannot run this request because LoRA Style X is not installed.");
    }
  });

  it("uses the 5060 Ti only after primary health failure, verified state, and live validation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("100.75.162.64")) throw new TypeError("offline");
      if (url.endsWith("/system_stats")) return new Response(JSON.stringify({ devices: [{ name: "NVIDIA GeForce RTX 5060 Ti" }] }), { status: 200 });
      if (url.endsWith("/object_info")) return new Response(JSON.stringify({ TestVideoNode: { input: { required: {} } } }), { status: 200 });
      return new Response("not found", { status: 404 });
    }));
    const selected = await selectVideoBackend(
      { workflowId: "presets/Create a Video" },
      { "1": { class_type: "TestVideoNode", inputs: { width: 1024, length: 97 } } }
    );
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.backend.id).toBe("rtx5060ti");
      expect(selected.fallbackActive).toBe(true);
      expect(selected.graph?.["1"].inputs.width).toBe(1024);
    }
  });

  it("returns a clear VRAM incompatibility error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const selected = await selectVideoBackend({ workflowId: "presets/Production IA2V Lip Sync" });
    expect(selected.ok).toBe(false);
    if (!selected.ok) expect(selected.error).toBe("RTX 3090 is unavailable. This workflow is not verified for the RTX 5060 Ti because: Measured VRAM exceeds 16 GB.");
  });

  it.each([
    ["missing-model", "Missing model files: wan.gguf"],
    ["missing-node", "Missing node classes: UnetLoaderGGUF"],
    ["unsupported-vram", "Measured VRAM exceeds 16 GB"],
  ])("rejects fallback state %s before probing or submitting", async (state, reason) => {
    writeCapabilityFixture("verified", state, reason);
    const fetchMock = vi.fn(async () => { throw new TypeError("primary offline"); });
    vi.stubGlobal("fetch", fetchMock);
    const selected = await selectVideoBackend({ workflowId: "presets/Create a Video" }, { "1": { class_type: "TestVideoNode", inputs: {} } });
    expect(selected.ok).toBe(false);
    if (!selected.ok) expect(selected.error).toContain(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/prompt"))).toBe(false);
  });
});
