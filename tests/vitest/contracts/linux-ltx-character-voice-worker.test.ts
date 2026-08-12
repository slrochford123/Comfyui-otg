import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

type WorkflowNode = {
  class_type?: string;
  inputs?: Record<string, unknown>;
};

type WorkflowGraph = Record<string, WorkflowNode>;

const readWorkflow = (): WorkflowGraph =>
  JSON.parse(read("comfy_workflows/presets/LTX Voice Sample.json")) as WorkflowGraph;

describe("Linux LTX character voice worker", () => {
  it("claims only LTX and Unnatural LTX voice-sample jobs", () => {
    const worker = read("scripts/linux/otg-character-ltx-voice-worker.py");
    expect(worker).toContain('"action": "create_voice_sample"');
    expect(worker).toContain('"providers": ["ltx", "unnatural_ltx"]');
    expect(worker).toContain("Linux LTX character voice sample completed");
  });

  it("is restricted to the Linux RTX 3090 and shares the voice GPU lock", () => {
    const worker = read("scripts/linux/otg-character-ltx-voice-worker.py");
    expect(worker).toContain('"http://100.75.162.64:8188"');
    expect(worker).toContain("Linux LTX Voice is restricted to the RTX 3090");
    expect(worker).toContain("acquire_gpu_lock");
    expect(worker).toContain("voice-gpu.lock");
  });

  it("validates the official full checkpoint across all three LTX loaders", () => {
    const worker = read("scripts/linux/otg-character-ltx-voice-worker.py");
    expect(worker).toContain("resolve_runtime_contract");
    expect(worker).toContain("/object_info");
    expect(worker).toContain(
      'options_for_input(object_info, "CheckpointLoaderSimple", "ckpt_name")',
    );
    expect(worker).toContain(
      'for class_type in ("LTXVAudioVAELoader", "LTXAVTextEncoderLoader")',
    );
    expect(worker).toContain("ltx-2.3-22b-dev-fp8.safetensors");
    expect(worker).not.toContain('options_for_input(object_info, "UNETLoader", "unet_name")');
    expect(worker).not.toContain('options_for_input(object_info, "VAELoader", "vae_name")');
  });

  it("uses a low-resolution carrier and exports node 384 audio", () => {
    const worker = read("scripts/linux/otg-character-ltx-voice-worker.py");
    expect(worker).toContain('"OTG_LTX_VOICE_CARRIER_WIDTH", "384"');
    expect(worker).toContain('"OTG_LTX_VOICE_CARRIER_HEIGHT", "224"');
    expect(worker).toContain('outputs.get("384")');
    expect(worker).toContain('save_audio["inputs"]["audio"] = ["354", 0]');
  });

  it("restores the official full-checkpoint model, VAE, audio, and projection contract", () => {
    const workflow = readWorkflow();
    const checkpoint = "ltx-2.3-22b-dev-fp8.safetensors";

    expect(workflow["373"]?.class_type).toBe("CheckpointLoaderSimple");
    expect(workflow["373"]?.inputs?.ckpt_name).toBe(checkpoint);
    expect(workflow["336"]?.class_type).toBe("LTXVAudioVAELoader");
    expect(workflow["336"]?.inputs?.ckpt_name).toBe(checkpoint);
    expect(workflow["374"]?.class_type).toBe("LTXAVTextEncoderLoader");
    expect(workflow["374"]?.inputs?.ckpt_name).toBe(checkpoint);

    expect(workflow["342"]?.inputs?.model).toEqual(["373", 0]);
    expect(workflow["344"]?.inputs?.vae).toEqual(["373", 2]);
    expect(workflow["345"]?.inputs?.vae).toEqual(["373", 2]);
    expect(workflow["353"]?.inputs?.vae).toEqual(["373", 2]);
    expect(workflow["385"]).toBeUndefined();
  });

  it("uses the official FP8 Gemma encoder with the official default loader path", () => {
    const worker = read("scripts/linux/otg-character-ltx-voice-worker.py");
    const workflow = readWorkflow();

    expect(worker).toContain("gemma_3_12B_it_fp8_scaled.safetensors");
    expect(worker).toContain('TEXT_ENCODER_DEVICE = "default"');
    expect(workflow["374"]?.inputs?.text_encoder).toBe(
      "gemma_3_12B_it_fp8_scaled.safetensors",
    );
    expect(workflow["374"]?.inputs?.device).toBe("default");
  });

  it("exports the generated audio through node 384", () => {
    const workflow = readWorkflow();
    expect(workflow["384"]?.class_type).toBe("SaveAudioMP3");
    expect(workflow["384"]?.inputs?.filename_prefix).toBe(
      "audio/otg_ltx_voice",
    );
    expect(workflow["384"]?.inputs?.audio).toEqual(["354", 0]);
  });
});
