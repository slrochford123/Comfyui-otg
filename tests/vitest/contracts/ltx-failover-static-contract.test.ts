import fs from "node:fs";
import { describe, expect, it } from "vitest";

const promptSubmissionEntrypoints = [
  "app/api/comfy/route.ts",
  "app/api/characters/create-image/route.ts",
  "app/api/angles/create-image/route.ts",
  "app/api/angles/multiview-assist/route.ts",
  "app/api/angles/model-3d/route.ts",
  "app/api/angles/trellis-3d/route.ts",
  "app/api/3d/generate-character-mv/route.ts",
  "app/api/background-angle-plate/route.ts",
  "app/api/background-remove/route.ts",
  "app/api/background-remove-people/route.ts",
  "app/api/otg/generate/route.ts",
  "app/api/preview/route.ts",
  "app/api/production/background/route.ts",
  "app/api/production/picture/route.ts",
  "app/api/production/picture/scene-pass/route.ts",
  "app/api/storyboard/create/route.ts",
  "app/api/storyboard/batch-generate/route.ts",
  "app/api/queue/next/route.ts",
  "app/api/queue/queue/next/route.ts",
  "app/api/characters/animate-preview/route.ts",
  "app/api/edit-video/ltx-edit/route.ts",
  "app/api/edit-video/music-generate/route.ts",
  "app/api/edit-video/woosh-sfx/route.ts",
  "app/api/production/animate/route.ts",
  "app/api/production/assembly-music/route.ts",
  "app/api/production/edit-video/route.ts",
  "app/api/production/video/route.ts",
  "lib/comfyVoices.ts",
] as const;

describe("TEST RTX 5060 Ti submission coverage", () => {
  it.each(promptSubmissionEntrypoints)("makes %s use the shared lock-aware prompt submitter", (file) => {
    const source = fs.readFileSync(file, "utf8");
    expect(source).toContain("submitComfyPromptWith5060Lease");
  });

  it("uses the authenticated worker-control agent for the remote 8191 lifecycle", () => {
    const catalog = fs.readFileSync("lib/workers/workerCatalog.ts", "utf8");
    const agent = fs.readFileSync("scripts/linux/otg-worker-agent.py", "utf8");
    expect(catalog).toContain('id: "ltx-audio-5060"');
    expect(catalog).toContain('gpu:linux-5060ti');
    expect(agent).toContain("otg-character-ltx-audio-5060-3003.service");
    expect(agent).toContain('http://100.98.212.116:8191/system_stats');
    expect(agent).toContain("/api/worker-control/agent/claim");
    expect(agent).toContain("authorization");
    expect(agent).not.toContain("sudo systemctl");
    const unit = fs.readFileSync("ops/ubuntu/systemd/otg-ltx-5060-worker-agent.service", "utf8");
    expect(unit).toContain("User=root");
    expect(unit).toContain("ExecStart=/usr/bin/python3 /opt/otg-ltx-5060-worker-agent/otg-worker-agent.py");
    expect(unit).toContain("[Install]");
    expect(unit).not.toMatch(/^(Wants|Requires)=.*otg-character-ltx-audio-5060-3003\.service/m);
  });

  it("keeps the fallback lease until output collection, persistence, and job finalization finish", () => {
    const source = fs.readFileSync("scripts/linux/otg-character-ltx-voice-worker.py", "utf8");
    const start = source.indexOf("def process_one_failover");
    const end = source.indexOf("def find_audio_for_node", start);
    const worker = source.slice(start, end);
    const generation = worker.indexOf("history_for_prompt");
    const collected = worker.indexOf("copy_comfy_audio", generation);
    const persisted = worker.indexOf("upload_sample", collected);
    const finalized = worker.indexOf('/api/worker/jobs/complete', persisted);
    const released = worker.indexOf("release_cluster_gpu_lease", finalized);
    expect(start).toBeGreaterThanOrEqual(0);
    expect([generation, collected, persisted, finalized, released].every((value) => value >= 0)).toBe(true);
    expect(generation).toBeLessThan(collected);
    expect(collected).toBeLessThan(persisted);
    expect(persisted).toBeLessThan(finalized);
    expect(finalized).toBeLessThan(released);
  });

  it("keeps the proven split-aux fallback workflow free of the full NVFP4 checkpoint and old distilled LoRA", () => {
    const workflowPath = "comfy_workflows/internal/characters/ltx_voice_5060_split_aux_api.json";
    const source = fs.readFileSync(workflowPath, "utf8");
    const workflow = JSON.parse(source) as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
    expect(source).toContain("ltx-2.3-22b-distilled-1.1-Q3_K_S.gguf");
    expect(source).toContain("gemma_3_12B_it_fp4_mixed.safetensors");
    expect(source).toContain("ltx-2.3_text_projection_bf16.safetensors");
    expect(source).toContain("LTX23_audio_vae_bf16.safetensors");
    expect(source).not.toContain("ltx-2.3-22b-dev-nvfp4.safetensors");
    expect(source).not.toContain("ltx-2.3-22b-distilled-lora-384-1.1.safetensors");
    expect(Object.values(workflow).filter((node) => /lora/i.test(String(node.class_type || "")))).toHaveLength(0);
    expect(workflow["4"]?.class_type).toBe("CLIPTextEncode");
    expect(workflow["5"]?.class_type).toBe("CLIPTextEncode");
    expect(workflow["8"]?.class_type).toBe("RandomNoise");
    expect(workflow["18"]?.class_type).toBe("SaveAudio");
  });
});
