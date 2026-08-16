import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const representativeRoutes = [
  "app/api/comfy/route.ts",
  "app/api/characters/create-image/route.ts",
  "app/api/background-remove/route.ts",
  "app/api/production/background/route.ts",
  "app/api/production/picture/route.ts",
  "app/api/production/video/route.ts",
  "app/api/storyboard/create/route.ts",
  "lib/comfyVoices.ts",
] as const;

describe("Comfy generation physical-GPU lock gate", () => {
  it.each(representativeRoutes)("wires %s through the shared leased submission helper", (file) => {
    const source = fs.readFileSync(file, "utf8");
    expect(source).toContain("submitComfyPromptWith5060Lease");
  });

  it("does not contain an active TypeScript fetch-to-/prompt bypass", () => {
    const roots = ["app/api", "lib"];
    const files: string[] = [];
    const visit = (entry: string) => {
      for (const item of fs.readdirSync(entry, { withFileTypes: true })) {
        const full = path.join(entry, item.name);
        if (item.isDirectory()) visit(full);
        else if (/\.(?:ts|tsx)$/.test(item.name)) files.push(full);
      }
    };
    roots.forEach(visit);

    const bypasses: string[] = [];
    for (const file of files) {
      if (file === "lib/workers/comfyPromptLease.ts") continue;
      const source = fs.readFileSync(file, "utf8");
      const postsPrompt = /(?:fetch|fetchStage|fetchJson)\s*\([\s\S]{0,240}?\/prompt[\s\S]{0,240}?method\s*:\s*["']POST["']/i.test(source)
        || /method\s*:\s*["']POST["'][\s\S]{0,240}?(?:fetch|fetchStage|fetchJson)\s*\([\s\S]{0,160}?\/prompt/i.test(source);
      if (postsPrompt && !source.includes("submitComfyPromptWith5060Lease") && !source.includes("submitComfyPromptWithGpuLease")) {
        bypasses.push(file);
      }
    }
    expect(bypasses).toEqual([]);
  });

  it("uses canonical WorkerManager GPU leases in the active Linux LTX failover path", () => {
    const source = fs.readFileSync("scripts/linux/otg-character-ltx-voice-worker.py", "utf8");
    const active = source.slice(source.indexOf("def process_one_failover"), source.indexOf("def find_audio_for_node"));
    expect(active).toContain('"gpu:shawn-3090", "video"');
    expect(active).toContain('"gpu:slr-5060", "ltx-fallback"');
    expect(active).toContain("acquire_cluster_gpu_lease");
    expect(active).toContain("release_cluster_gpu_lease");
    expect(active).not.toContain("fcntl.flock");
    expect(active.indexOf("acquire_cluster_gpu_lease")).toBeLessThan(active.indexOf("submit_comfy(active_args, graph)"));
  });

  it("requires the operator capability matrix to acquire the physical WorkerManager lock", () => {
    const source = fs.readFileSync("scripts/run-comfy-capability-matrix.mjs", "utf8");
    expect(source).toContain("/api/worker-control/resource-lock/acquire");
    expect(source).toContain("/api/worker-control/resource-lock/release");
    expect(source).toContain("OTG_WORKER_TOKEN");
    expect(source.indexOf("acquireGpuLease(runName)")).toBeLessThan(source.indexOf("`${endpoint}/prompt`"));
    expect(source).toContain("safeToRelease = false");
  });

  it("passes every centralized Qwen caller an effective timeout", () => {
    const expectations: Record<string, string> = {
      "app/api/enhance/route.ts": "{ timeoutMs }",
      "app/api/enhance-prompt/route.ts": "{ timeoutMs }",
      "app/api/format-prompt/route.ts": "{ timeoutMs }",
      "app/api/vision-prompt/route.ts": "requiredContextTokens: numCtx, timeoutMs",
      "app/api/characters/enhance-description/route.ts": "{ timeoutMs }",
      "app/api/storyboard/format/route.ts": "{ timeoutMs }",
      "app/api/storyboard/batch-generate/route.ts": "{ timeoutMs }",
      "app/api/ollama-ai/chat/route.ts": "{ timeoutMs }",
      "app/api/ollama-ai/plan/route.ts": "{ timeoutMs }",
      "app/api/ollama-ai/write/route.ts": "{ timeoutMs }",
      "lib/storyboard/ollama.ts": "{ timeoutMs }",
    };
    for (const [file, marker] of Object.entries(expectations)) {
      expect(fs.readFileSync(file, "utf8"), file).toContain(marker);
    }
  });
});
