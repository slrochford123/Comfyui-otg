import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getWorkerCatalogEntry } from "@/lib/workers/workerCatalog";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Linux Qwen3 character voice worker", () => {
  it("registers the voice-design worker on Linux RTX 3090", () => {
    const worker = getWorkerCatalogEntry("voice-design");
    expect(worker?.platform).toBe("linux");
    expect(worker?.kind).toBe("polling-worker");
    expect(worker?.gpu).toBe("linux-3090");
    expect(worker?.resources).toContain("service:voice-design");
    expect(worker?.resources).toContain("service:qwen3-tts");
  });

  it("does not advertise a persistent standalone Qwen3 service", () => {
    const runtime = getWorkerCatalogEntry("qwen3-tts");
    expect(runtime?.platform).toBe("linux");
    expect(runtime?.enabled).toBe(false);
    expect(runtime?.dryRunOnly).toBe(true);
    expect(runtime?.userStatusKind).toBe("one-shot");
  });

  it("uses Linux worker wording in the Characters UI", () => {
    const panel = read("app/app/components/CharactersPanel.tsx");
    expect(panel).toContain('queued: "Waiting for Linux voice worker..."');
    expect(panel).not.toContain('queued: "Waiting for Windows voice worker..."');
  });

  it("claims only real Qwen3 create_voice_sample jobs", () => {
    const worker = read("scripts/linux/otg-character-voice-worker.py");
    expect(worker).toContain('"action": "create_voice_sample"');
    expect(worker).toContain('"providers": ["qwen3"]');
    expect(worker).toContain('build_url(args.comfy_url, "/queue")');
    expect(worker).toContain('build_url(args.comfy_url, "/free")');
    expect(worker).toContain('"mock": False');
  });

  it("loads Qwen3-TTS per job and writes a real WAV", () => {
    const bridge = read("scripts/linux/qwen3_voice_design_preview.py");
    expect(bridge).toContain("Qwen3TTSModel.from_pretrained");
    expect(bridge).toContain("model.generate_voice_design");
    expect(bridge).toContain("sf.write");
    expect(bridge).toContain("torch.cuda.empty_cache");
  });

  it("defines a restartable Linux systemd worker", () => {
    const unit = read("ops/ubuntu/systemd/otg-character-voice-worker.service");
    expect(unit).toContain("User=shawn-rochford");
    expect(unit).toContain("EnvironmentFile=/etc/otg/character-completion-worker.env");
    expect(unit).toContain("EnvironmentFile=/etc/otg/character-voice-worker.env");
    expect(unit).toContain("Restart=always");
  });
});
