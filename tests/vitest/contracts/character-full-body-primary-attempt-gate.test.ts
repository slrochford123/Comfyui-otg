import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  primaryManifestSupportAllowsAttempt,
  selectManifestBackend,
  type BackendSupport,
  type WorkflowCapability,
} from "@/lib/comfyCapabilities";

function workflow(id: string): WorkflowCapability {
  return {
    id,
    workflowFile: `${id}.json`,
    kind: "image",
    requiredNodeTypes: [],
    requiredModels: [],
    requiredLoras: [],
    requiredInputAssets: ["image"],
    expectedInputCount: 1,
    expectedOutputTypes: ["image"],
    estimatedOrMeasuredVramGb: null,
    backendSupport: {},
  };
}

function support(
  state: BackendSupport["state"],
  missingNodes: string[] = [],
  missingModels: string[] = [],
): BackendSupport {
  return {
    state,
    reason: "test",
    missingNodes,
    missingModels,
    testedConfiguration: null,
    estimatedOrMeasuredVramGb: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Characters full-body Edit Image backend routing", () => {
  it("allows only dependency-complete installed-not-tested Edit Image support", () => {
    const editImage = workflow("presets/Edit Image");
    const otherImage = workflow("presets/Anime to Realism");

    expect(
      primaryManifestSupportAllowsAttempt(
        editImage,
        support("installed-not-tested"),
        true,
      ),
    ).toBe(true);

    expect(
      primaryManifestSupportAllowsAttempt(
        editImage,
        support("installed-not-tested", ["MissingNode"], []),
        true,
      ),
    ).toBe(false);

    expect(
      primaryManifestSupportAllowsAttempt(
        editImage,
        support("installed-not-tested", [], ["missing.safetensors"]),
        true,
      ),
    ).toBe(false);

    expect(
      primaryManifestSupportAllowsAttempt(
        otherImage,
        support("installed-not-tested"),
        true,
      ),
    ).toBe(false);

    expect(
      primaryManifestSupportAllowsAttempt(
        otherImage,
        support("verified"),
        true,
      ),
    ).toBe(true);
  });

  it("prefers verified Edit Image on the healthy RTX 5060 Ti", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain("192.168.1.113:8188/system_stats");
      return new Response(
        JSON.stringify({ devices: [{ name: "NVIDIA GeForce RTX 5060 Ti" }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const selected = await selectManifestBackend(
      { workflowId: "presets/Edit Image" },
      1,
    );

    expect(selected.ok).toBe(true);
    if (!selected.ok) throw new Error(selected.error);
    expect(selected.backend.id).toBe("rtx5060ti");
    expect(selected.fallbackActive).toBe(true);
    expect(selected.selectionReason).toBe(
      "edit_image_verified_rtx5060ti_preferred",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the dependency-complete RTX 3090 when preferred Edit Image RTX 5060 Ti is unavailable", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("192.168.1.113:8188/system_stats")) {
        throw new Error("RTX 5060 Ti unavailable");
      }

      expect(url).toContain("100.75.162.64:8188/system_stats");

      return new Response(
        JSON.stringify({ devices: [{ name: "NVIDIA GeForce RTX 3090" }] }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const selected = await selectManifestBackend(
      { workflowId: "presets/Edit Image" },
      1,
    );

    expect(selected.ok).toBe(true);
    if (!selected.ok) throw new Error(selected.error);

    expect(selected.backend.id).toBe("rtx3090");
    expect(selected.fallbackActive).toBe(false);
    expect(selected.selectionReason).toBe(
      "primary_healthy_dependency_complete_installed_not_tested",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate the same full-body failure in message and error boxes", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/app/components/CharactersPanel.tsx"),
      "utf8",
    );

    const messageStart = source.indexOf(
      'setMessage("Generating full-body character from uploaded reference...")',
    );
    const catchStart = source.indexOf("} catch (err: any) {", messageStart);
    const catchEnd = source.indexOf("} finally {", catchStart);
    const block = source.slice(catchStart, catchEnd);

    expect(block).toContain("setError(message);");
    expect(block).toContain('setMessage("");');
    expect(block).not.toContain("setMessage(message);");
  });
});
