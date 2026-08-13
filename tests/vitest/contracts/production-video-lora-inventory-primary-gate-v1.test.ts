import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  primaryVideoSupportAllowsAttempt,
  selectVideoBackend,
} from "@/lib/videoBackendFailover";
import {
  isSafeProductionLoraName,
  selectProductionLoraInventory,
} from "@/lib/productionVideoLoraInventory";

let fixtureDir = "";

function support(state: string, reason: string, missingModels: string[] = [], missingNodes: string[] = []) {
  return {
    state,
    reason,
    missingNodes,
    missingModels,
    testedConfiguration: null,
    estimatedOrMeasuredVramGb: null,
  };
}

function writeCapabilityFixture(primaryState: string, fallbackState: string) {
  const manifestVersion = "production-video-lora-inventory-primary-gate-v1";
  fs.writeFileSync(path.join(fixtureDir, "backends.json"), JSON.stringify({
    manifestVersion,
    policy: {
      primaryBackendId: "rtx3090",
      fallbackBackendId: "rtx5060ti",
      requireVerifiedWorkflow: true,
    },
    backends: [
      {
        id: "rtx3090",
        label: "RTX 3090",
        url: "http://100.75.162.64:8188",
        gpu: "RTX 3090",
        vramGb: 24,
        priority: 1,
        health: "healthy",
        availableNodeClassTypes: [],
        availableModelFilenames: [],
        supportedWorkflowIds: [],
        lastVerifiedAt: "2026-07-25T00:00:00Z",
      },
      {
        id: "rtx5060ti",
        label: "RTX 5060 Ti",
        url: "http://192.168.1.113:8188",
        gpu: "RTX 5060 Ti",
        vramGb: 16,
        priority: 2,
        health: "healthy",
        availableNodeClassTypes: [],
        availableModelFilenames: [],
        supportedWorkflowIds: [],
        lastVerifiedAt: "2026-07-25T00:00:00Z",
      },
    ],
  }));
  fs.writeFileSync(path.join(fixtureDir, "workflows.json"), JSON.stringify({
    manifestVersion,
    workflows: [
      {
        id: "presets/Create a Video from Images",
        workflowFile: "presets/Create a Video from Images.json",
        kind: "video",
        requiredNodeTypes: [],
        requiredModels: [],
        requiredLoras: [],
        requiredInputAssets: ["image", "image"],
        expectedInputCount: 2,
        expectedOutputTypes: ["video"],
        estimatedOrMeasuredVramGb: null,
        backendSupport: {
          rtx3090: support(primaryState, "Primary fixture state."),
          rtx5060ti: support(
            fallbackState,
            "Missing model files: Ltx2.3-Licon-VBVR-I2V-96000-R32.safetensors",
            fallbackState === "missing-model"
              ? ["Ltx2.3-Licon-VBVR-I2V-96000-R32.safetensors"]
              : []
          ),
        },
      },
    ],
  }));
}

function inventory(
  backendId: "rtx3090" | "rtx5060ti",
  ok: boolean,
  names: string[],
  error: string | null = null
) {
  return {
    backendId,
    backendLabel: backendId === "rtx3090" ? "RTX 3090 primary" : "RTX 5060 Ti fallback",
    ok,
    retrievedAt: "2026-07-25T00:00:00.000Z",
    items: names.map((exactFilename) => ({
      backendId,
      exactFilename,
      normalizedFilename: exactFilename.replaceAll("\\", "/").toLowerCase(),
      available: true as const,
      inferredFamily: null,
      sourceEndpoint: "/models/loras",
      retrievedAt: "2026-07-25T00:00:00.000Z",
    })),
    nodeSupport: {
      loraLoaderModelOnly: ok,
      powerLoraLoaderRgthree: ok,
    },
    sources: ["/models/loras"],
    error,
  };
}

beforeEach(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "otg-production-video-lora-gate-"));
  writeCapabilityFixture("installed-not-tested", "missing-model");
  vi.stubEnv("OTG_COMFY_BACKENDS_FILE", path.join(fixtureDir, "backends.json"));
  vi.stubEnv("OTG_COMFY_WORKFLOW_CAPABILITIES_FILE", path.join(fixtureDir, "workflows.json"));
});

afterEach(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Production LoRA inventory compatibility route", () => {
  it("uses the 3090 inventory and returns safe relative ComfyUI filenames", () => {
    const selected = selectProductionLoraInventory([
      inventory("rtx3090", true, [
        "Singularity-LTX-2.3_OmniCine_V1.safetensors",
        "styles\\anime90s-step00053000.comfy.safetensors",
        "../outside.safetensors",
        "/home/user/private.safetensors",
        "styles\\anime90s-step00053000.comfy.safetensors",
      ]),
      inventory("rtx5060ti", true, ["fallback-only.safetensors"]),
    ]);
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.backendId).toBe("rtx3090");
      expect(selected.fallbackActive).toBe(false);
      expect(selected.loras).toEqual([
        { name: "Singularity-LTX-2.3_OmniCine_V1.safetensors" },
        { name: "styles\\anime90s-step00053000.comfy.safetensors" },
      ]);
    }
  });

  it("uses fallback inventory only when the primary inventory is unavailable", () => {
    const selected = selectProductionLoraInventory([
      inventory("rtx3090", false, [], "primary offline"),
      inventory("rtx5060ti", true, ["fallback-style.safetensors"]),
    ]);
    expect(selected).toMatchObject({
      ok: true,
      backendId: "rtx5060ti",
      fallbackActive: true,
      loras: [{ name: "fallback-style.safetensors" }],
    });
  });

  it("rejects absolute, traversal, control-character, and non-LoRA model names", () => {
    expect(isSafeProductionLoraName("folder/style.safetensors")).toBe(true);
    expect(isSafeProductionLoraName("../style.safetensors")).toBe(false);
    expect(isSafeProductionLoraName("/opt/ComfyUI/models/loras/style.safetensors")).toBe(false);
    expect(isSafeProductionLoraName("C:\\AI\\style.safetensors")).toBe(false);
    expect(isSafeProductionLoraName("style\n.safetensors")).toBe(false);
    expect(isSafeProductionLoraName("model.gguf")).toBe(false);
  });

  it("keeps the existing Storyboard endpoint backed by a real route", () => {
    const root = process.cwd();
    const storyboard = fs.readFileSync(path.join(root, "app/app/components/StoryboardPanel.tsx"), "utf8");
    const route = fs.readFileSync(path.join(root, "app/api/comfy/loras/route.ts"), "utf8");
    expect(storyboard).toContain("fetch(`/api/comfy/loras");
    expect(route).toContain("fetchAllVideoLoraInventories");
    expect(route).toContain("selectProductionLoraInventory");
    expect(route).toContain("loras: selected.loras");
  });
});

describe("RTX 3090 primary eligibility gate", () => {
  it("allows dependency-complete installed-not-tested support when verification policy is enabled", () => {
    expect(primaryVideoSupportAllowsAttempt(
      support("installed-not-tested", "Installed.", [], []),
      true
    )).toBe(true);
    expect(primaryVideoSupportAllowsAttempt(
      support("installed_not_tested", "Installed.", [], []),
      true
    )).toBe(true);
    expect(primaryVideoSupportAllowsAttempt(
      support("installed not tested", "Installed.", [], []),
      true
    )).toBe(true);
    expect(primaryVideoSupportAllowsAttempt(
      support("verified", "Verified.", [], []),
      true
    )).toBe(true);
    expect(primaryVideoSupportAllowsAttempt(
      support("installed-not-tested", "Missing.", ["missing.safetensors"], []),
      true
    )).toBe(false);
    expect(primaryVideoSupportAllowsAttempt(
      support("installed-not-tested", "Missing.", [], ["MissingNode"]),
      true
    )).toBe(false);
    expect(primaryVideoSupportAllowsAttempt(
      support("missing-node", "Missing.", [], []),
      true
    )).toBe(false);
  });

  it("routes dependency-complete installed-not-tested support to the primary without probing fallback", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("100.75.162.64:8188/system_stats");
      return new Response(
        JSON.stringify({ devices: [{ name: "NVIDIA GeForce RTX 3090" }] }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const selected = await selectVideoBackend({
      workflowId: "presets/Create a Video from Images",
    });

    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.backend.id).toBe("rtx3090");
      expect(selected.fallbackActive).toBe(false);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("100.75.162.64:8188/system_stats");
  });
});
