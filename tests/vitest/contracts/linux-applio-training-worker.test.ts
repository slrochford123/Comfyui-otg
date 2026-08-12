import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Linux Applio training worker", () => {
  it("claims only durable Applio training jobs", () => {
    const worker = read("scripts/linux/otg-character-applio-training-worker.py");
    expect(worker).toContain('"jobType": "character_voice_pipeline"');
    expect(worker).toContain('"action": "start_applio_training"');
    expect(worker).toContain('"claimScope": "all_owners"');
    expect(worker).not.toContain('"action": "generate_training_dataset"');
  });

  it("requires a real complete IndexTTS2 voice pack", () => {
    const worker = read("scripts/linux/otg-character-applio-training-worker.py");
    expect(worker).toContain('clean(manifest.get("generationMode")) != "real"');
    expect(worker).toContain('clean(manifest.get("status")) != "voice_pack_ready"');
    expect(worker).toContain("Real Applio training requires 200 ready clips");
  });

  it("preserves the Applio virtual-environment Python symlink", () => {
    const worker = read("scripts/linux/otg-character-applio-training-worker.py");
    expect(worker).toContain('python = Path(args.applio_python).expanduser().absolute()');
    expect(worker).not.toContain('python = Path(args.applio_python).resolve()');
  });

  it("runs the official preprocess extract train and index contract", () => {
    const worker = read("scripts/linux/otg-character-applio-training-worker.py");
    expect(worker).toContain('plan["coreScript"], "preprocess"');
    expect(worker).toContain('plan["coreScript"], "extract"');
    expect(worker).toContain('plan["coreScript"], "train"');
    expect(worker).toContain("find_outputs(plan)");
    expect(worker).toContain("*.index");
    expect(worker).toContain("*.pth");
  });

  it("serializes RTX 3090 use and releases idle ComfyUI models", () => {
    const worker = read("scripts/linux/otg-character-applio-training-worker.py");
    expect(worker).toContain("OTG_VOICE_GPU_LOCK_FILE");
    expect(worker).toContain("fcntl.flock");
    expect(worker).toContain('build_url(args.comfy_url, "/queue")');
    expect(worker).toContain('build_url(args.comfy_url, "/free")');
    expect(worker).toContain("nvidia-smi");
  });

  it("registers Linux Applio routing and catalog metadata", () => {
    const jobs = read("lib/jobs/voicePipelineJobs.ts");
    const catalog = read("lib/workers/workerCatalog.ts");
    expect(jobs).toContain("Linux Applio training worker");
    expect(jobs).toContain("linux-applio-training-worker");
    expect(catalog).toContain('displayName: "Linux Applio Training Worker"');
    expect(catalog).toContain('resources: ["gpu:linux-3090", "service:applio"]');
    expect(catalog).toContain('gpu: "linux-3090"');
  });

  it("installs a dedicated Linux systemd service", () => {
    const unit = read("ops/ubuntu/systemd/otg-character-applio-training-worker.service");
    expect(unit).toContain("EnvironmentFile=/etc/otg/character-applio-training-worker.env");
    expect(unit).toContain("otg-character-applio-training-worker.py");
    expect(unit).toContain("WorkingDirectory=/home/shawn-rochford/AI/runtime/test/Applio");
  });
});
