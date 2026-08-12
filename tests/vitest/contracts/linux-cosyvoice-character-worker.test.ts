import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Linux CosyVoice3 character worker", () => {
  it("claims only CosyVoice create_voice_sample jobs", () => {
    const worker = read("scripts/linux/otg-character-cosyvoice-worker.py");
    expect(worker).toContain('"action": "create_voice_sample"');
    expect(worker).toContain('"providers": ["cosy"]');
    expect(worker).toContain("CosyVoice3 character voice sample completed");
  });

  it("preserves the environment Python path instead of resolving its symlink", () => {
    const worker = read("scripts/linux/otg-character-cosyvoice-worker.py");
    expect(worker).toContain("absolute_path_without_resolving_symlink");
    expect(worker).not.toContain("Path(args.cosy_python).expanduser().resolve()");
  });

  it("uses the official CosyVoice3 instruct2 path", () => {
    const bridge = read("scripts/linux/cosy_voice_sample_bridge.py");
    expect(bridge).toContain("AutoModel");
    expect(bridge).toContain("inference_instruct2");
    expect(bridge).toContain("stream=False");
  });

  it("registers CosyVoice as a Linux Worker Manager worker", () => {
    const catalog = read("lib/workers/workerCatalog.ts");
    expect(catalog).toContain('id: "cozyvoice"');
    expect(catalog).toContain('displayName: "Linux CosyVoice3 Character Worker"');
    expect(catalog).toContain('gpu: "linux-3090"');
  });
});
