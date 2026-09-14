import fs from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = fs.readFileSync(
  "app/api/characters/voice-pipeline/route.ts",
  "utf8",
);

const workerSource = fs.readFileSync(
  "scripts/linux/otg-character-applio-inference-worker.py",
  "utf8",
);

describe("Voice Characters owner-scoped typed Test Voice contract", () => {
  it("resolves trained Test Voice artifacts on the server for the current owner", () => {
    expect(routeSource).toContain("resolveOwnerScopedTestVoiceRequest");
    expect(routeSource).toContain("recoverLatestTrainedApplioVoiceProfileForTestVoice");
    expect(routeSource).toContain("findUsableTrainedVoiceArtifactForTestVoice");
    expect(routeSource).toContain("serverResolvedTrainedVoice: true");
    expect(routeSource).toContain("serverResolvedOwnerKey: ownerKey");

    expect(routeSource).toMatch(
      /trainedModelPath:\s*modelPath/,
    );
    expect(routeSource).toMatch(
      /trainedIndexPath:\s*indexPath/,
    );
    expect(routeSource).toMatch(
      /inputAudioPath:\s*referenceAudioPath/,
    );

    expect(routeSource).toContain(
      "const requestValue = ownerScopedRequest.value;",
    );
    expect(routeSource).toContain(
      "createCharacterVoicePipelineJob(owner.ownerKey, requestValue)",
    );
    expect(routeSource).not.toContain(
      "createCharacterVoicePipelineJob(owner.ownerKey, body.value)",
    );
  });

  it("rejects model or index paths outside the current owner's canonical Applio root", () => {
    expect(routeSource).toContain("resolveOwnedTestVoiceArtifactPath");
    expect(routeSource).toContain('"applio-models"');
    expect(routeSource).toContain("pathForTestVoice.relative");
    expect(routeSource).toContain(
      "Trained voice artifact does not belong to the current owner/character.",
    );
  });

  it("generates typed source speech with Linux IndexTTS2 before Applio conversion", () => {
    expect(workerSource).toContain("generate_typed_source_speech");
    expect(workerSource).toContain("index_tts2_clone_pack_bridge.py");
    expect(workerSource).toContain(
      'speech_text = clean(job_input.get("text"))',
    );
    expect(workerSource).toContain(
      "Typed Test Voice requires non-empty text.",
    );
    expect(workerSource).toContain(
      '"sourceSpeechProvider": "indextts2"',
    );
    expect(workerSource).toContain(
      '"sourceSpeechAdapter": "indextts2_single_utterance"',
    );
    expect(workerSource).toContain(
      'command[command.index("--input_path") + 1] = str(input_audio)',
    );
    expect(workerSource).toContain(
      '"delivery": "neutral"',
    );
    expect(workerSource).toContain(
      '"use_random=False"',
    );
  });
});
