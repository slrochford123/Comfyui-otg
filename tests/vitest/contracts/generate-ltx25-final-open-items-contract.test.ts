import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(
    path.join(repoRoot, relativePath),
    "utf8",
  );
}

const ltx25WorkflowIds = [
  "presets/LTX 2.5 Text To Video",
  "presets/LTX 2.5 Image To Video",
  "presets/LTX 2.5 First Last Frame Video",
] as const;

describe("Generate LTX 2.5 final open-item contract", () => {
  it("keeps the canonical LTX output prefix immune to generic title rewriting", () => {
    const route = read("app/api/comfy/route.ts");

    expect(route).toMatch(
      /const title = String\(\(body as any\)\?\.title \|\| \(body as any\)\?\.name \|\| ""\)\.trim\(\);\s*if \(!ltx25VideoSettings\) \{\s*setFilenamePrefix__otg\(graph, title\);\s*\}/s,
    );
  });

  it("posts the native 704-pixel short dimension for Generate video", () => {
    const app = read("app/app/AppPageClient.tsx");

    const requestMarker =
      'body.set("requestKind", "video");';

    const requestIndex = app.indexOf(requestMarker);

    expect(requestIndex).toBeGreaterThan(-1);

    const videoStart = app.lastIndexOf(
      'if (generateMediaMode === "video") {',
      requestIndex,
    );

    const imageStart = app.indexOf(
      'if (generateMediaMode === "image") {',
      requestIndex,
    );

    expect(videoStart).toBeGreaterThan(-1);
    expect(imageStart).toBeGreaterThan(videoStart);

    /*
     * Important:
     * Isolate only the video branch.
     *
     * The following image branch intentionally remains 720x1280 /
     * 1280x720, so a fixed-length slice extending into that branch
     * would produce a false failure.
     */
    const videoBlock = app.slice(
      videoStart,
      imageStart,
    );

    expect(videoBlock).toContain(
      'body.set("width", orientation === "portrait" ? "704" : "1280");',
    );

    expect(videoBlock).toContain(
      'body.set("height", orientation === "portrait" ? "1280" : "704");',
    );

    expect(videoBlock).not.toContain(
      'body.set("width", orientation === "portrait" ? "720" : "1280");',
    );

    expect(videoBlock).not.toContain(
      'body.set("height", orientation === "portrait" ? "1280" : "720");',
    );

    expect(videoBlock).toContain(
      'body.set("frameRate", "24");',
    );
  });

  it("shows only explicitly compatible Video LoRAs", () => {
    const panel = read(
      "app/app/components/VideoLoraPanel.tsx",
    );

    expect(panel).toContain(
      "return (data?.compatibleEntries || []).filter",
    );

    expect(panel).toContain(
      "const entryById = new Map((data?.compatibleEntries || []).map",
    );

    expect(panel).toContain(
      "Only LoRAs explicitly verified for this workflow are shown.",
    );

    expect(panel).not.toContain(
      "Internal workflow LoRAs stay active",
    );
  });

  it("keeps the existing LTX 2.3 LoRA catalog fail-closed for LTX 2.5", () => {
    const catalog = JSON.parse(
      read("config/video-loras.json"),
    );

    const registry = read(
      "lib/videoLoras.ts",
    );

    for (const workflowId of ltx25WorkflowIds) {
      const selectable = (
        catalog.entries || []
      ).filter(
        (entry: any) =>
          entry?.catalogStatus === "active" &&
          Array.isArray(
            entry?.supportedWorkflowIds,
          ) &&
          entry.supportedWorkflowIds.includes(
            workflowId,
          ),
      );

      expect(selectable).toEqual([]);

      expect(registry).not.toContain(
        `"${workflowId}": ltxPatch`,
      );
    }
  });

  it("records the three local LTX 2.5 workflows as live-verified on the 3090", () => {
    const config = JSON.parse(
      read(
        "config/video_workflow_compatibility.json",
      ),
    );

    const byId = new Map(
      (config.workflows || []).map(
        (entry: any) => [
          entry.id,
          entry,
        ],
      ),
    );

    for (const workflowId of ltx25WorkflowIds) {
      const entry: any = byId.get(
        workflowId,
      );

      expect(entry).toBeTruthy();
      expect(entry.mode).toBe(
        "3090_only",
      );

      expect(
        String(entry.notes || ""),
      ).toContain(
        "live-verified on the RTX 3090",
      );

      expect(
        String(entry.notes || ""),
      ).not.toContain(
        "API workflow is staged",
      );
    }
  });
});
