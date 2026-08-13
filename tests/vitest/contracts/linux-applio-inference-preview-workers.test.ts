import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Linux Applio inference and character preview workers", () => {
  it("routes trained voice and character preview jobs to Linux workers", () => {
    const source = read("lib/jobs/voicePipelineJobs.ts");
    expect(source).toContain('return "Linux Applio inference worker"');
    expect(source).toContain('return "linux-applio-inference-worker"');
    expect(source).toContain('return "Linux character preview worker"');
    expect(source).toContain('return "linux-character-preview-worker"');
    expect(source).not.toContain('return "Windows Applio inference worker"');
    expect(source).not.toContain('return "Windows character preview worker"');
  });

  it("registers both Linux workers in the worker catalog", () => {
    const source = read("lib/workers/workerCatalog.ts");
    expect(source).toContain('id: "applio-inference"');
    expect(source).toContain('displayName: "Linux Applio Inference Worker"');
    expect(source).toContain('displayName: "Linux Character Preview Dub Worker"');
    expect(source).toContain('gpu: "linux-3090"');
  });

  it("limits the inference worker to test_trained_voice and preserves the Applio venv Python", () => {
    const source = read("scripts/linux/otg-character-applio-inference-worker.py");
    expect(source).toContain('"action": "test_trained_voice"');
    expect(source).toContain('linux-applio-inference-worker');
    expect(source).toContain('Path(args.applio_python).expanduser().absolute()');
    expect(source).toContain('/api/characters/applio-inference/file');
    expect(source).toContain('OTG_VOICE_GPU_LOCK_FILE');
  });

  it("builds and validates a real dubbed character preview", () => {
    const source = read("scripts/linux/otg-character-preview-worker.py");
    expect(source).toContain('"action": "generate_character_preview"');
    expect(source).toContain('linux-character-preview-worker');
    expect(source).toContain('dubbed-preview.mp4');
    expect(source).toContain('raw-preview.mp4');
    expect(source).toContain('dubbed-audio.wav');
    expect(source).toContain('espeak-ng');
    expect(source).toContain('ffprobe');
    expect(source).toContain('OTG_VOICE_GPU_LOCK_FILE');
    expect(source).toContain('Path(args.applio_python).expanduser().absolute()');
  });

  it("ships systemd units for both Linux workers", () => {
    const inferenceUnit = read("ops/ubuntu/systemd/otg-character-applio-inference-worker.service");
    const previewUnit = read("ops/ubuntu/systemd/otg-character-preview-worker.service");
    expect(inferenceUnit).toContain("otg-character-applio-inference-worker.py");
    expect(previewUnit).toContain("otg-character-preview-worker.py");
    expect(inferenceUnit).toContain("EnvironmentFile=/etc/otg/character-applio-inference-worker.env");
    expect(previewUnit).toContain("EnvironmentFile=/etc/otg/character-preview-worker.env");
  });
});
