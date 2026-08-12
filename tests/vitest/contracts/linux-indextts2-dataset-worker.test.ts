import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Linux IndexTTS2 dataset worker", () => {
  it("claims only durable training-dataset jobs", () => {
    const worker = read("scripts/linux/otg-character-indextts2-dataset-worker.py");
    expect(worker).toContain('"jobType": "character_voice_pipeline"');
    expect(worker).toContain('"action": "generate_training_dataset"');
    expect(worker).toContain('"claimScope": "all_owners"');
    expect(worker).not.toContain('"action": "start_applio_training"');
  });

  it("uses official IndexTTS2 inference without DeepSpeed or custom CUDA kernels", () => {
    const worker = read("scripts/linux/otg-character-indextts2-dataset-worker.py");
    expect(worker).toContain("from indextts.infer_v2 import IndexTTS2");
    expect(worker).toContain("use_deepspeed=False");
    expect(worker).toContain("use_cuda_kernel=False");
    expect(worker).toContain("tts.infer(");
  });

  it("shares the RTX 3090 voice lock and uploads resumable batches", () => {
    const worker = read("scripts/linux/otg-character-indextts2-dataset-worker.py");
    expect(worker).toContain("OTG_VOICE_GPU_LOCK_FILE");
    expect(worker).toContain("/api/characters/training-dataset/upload-batch");
    expect(worker).toContain("assert_job_active");
    expect(worker).toContain("Heartbeat");
  });

  it("registers the dataset worker as Linux RTX 3090", () => {
    const catalog = read("lib/workers/workerCatalog.ts");
    expect(catalog).toContain('id: "voice-dataset"');
    expect(catalog).toContain('displayName: "Linux IndexTTS2 Dataset Worker"');
    expect(catalog).toContain('platform: "linux"');
    expect(catalog).toContain('gpu: "linux-3090"');
  });

  it("removes stale Windows wording from active dataset status paths", () => {
    const jobs = read("lib/jobs/voicePipelineJobs.ts");
    const upload = read("app/api/characters/training-dataset/upload-batch/route.ts");
    expect(jobs).toContain("Queued / waiting for Linux IndexTTS2 dataset worker.");
    expect(upload).toContain("Linux IndexTTS2 dataset worker");
    expect(upload).not.toContain("Windows RTX 3090 IndexTTS2 worker");
  });
});
