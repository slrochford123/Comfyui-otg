import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Production Audio trained character voice dub contract", () => {
  it("lists trained Character Voice Applio artifacts as production voice models", () => {
    const route = read("app/api/voice/models/route.ts");

    expect(route).toContain("findUsableTrainedVoiceArtifact");
    expect(route).toContain("listCharacters(owner.ownerKey)");
    expect(route).toContain('engine: "character"');
    expect(route).toContain('provider: "applio"');
    expect(route).toContain("modelPath");
    expect(route).toContain("indexPath");
    expect(route).toContain("samplePath");
  });

  it("runs Preserve Performance through trained Applio model and index paths", () => {
    const voiceDubRoute = read("app/api/voice/dub/route.ts");
    const productionDubRoute = read("app/api/production/audio/dub-preview/route.ts");
    const analysisRoute = read("app/api/production/audio/analyze-clip/route.ts");

    expect(voiceDubRoute).toContain('type Engine = "applio" | "seed-vc" | "xtts"');
    expect(voiceDubRoute).toContain("runApplio");
    expect(voiceDubRoute).toContain("runAukRewriteSource");
    expect(voiceDubRoute).toContain('sourceSpeechMode = "auk-rewrite-line"');
    expect(voiceDubRoute).toContain("emotionInstruction");
    expect(voiceDubRoute).toContain("applio-trained-character-performance");
    expect(voiceDubRoute).toContain("Trained character voice dubbing requires both an Applio model path and index path.");

    expect(productionDubRoute).toContain('form.append("model_path", mapping.modelPath)');
    expect(productionDubRoute).toContain('form.append("index_path", mapping.indexPath)');
    expect(productionDubRoute).toContain('form.append("engine", mapping.engine || (mapping.modelPath && mapping.indexPath ? "applio" : "auto"))');
    expect(productionDubRoute).toContain('form.append("dub_mode", mapping.dubMode || "preserve_performance")');
    expect(productionDubRoute).toContain('form.append("emotion", mapping.emotion || "preserve")');
    expect(productionDubRoute).toContain("analysisBackgroundStemPathV36BPW9");
    expect(productionDubRoute).toContain('sourceBedKind: backgroundStemPath ? "demucs_background" : "original_audio"');
    expect(productionDubRoute).toContain("apad,atrim=0:${duration}");

    expect(analysisRoute).toContain('findRecursive(demucsOut, "vocals.wav")');
    expect(analysisRoute).toContain('findRecursive(demucsOut, "no_vocals.wav")');
    expect(analysisRoute).toContain("backgroundStemPath");
    expect(analysisRoute).toContain("extractVoiceLaneSamples");
    expect(analysisRoute).toContain("sampleUrl");
  });

  it("wires Advanced Controls in the Production Audio Studio UI", () => {
    const source = read("app/app/components/StoryboardPanel.tsx");

    expect(source).toContain("audioDubAdvancedOpen");
    expect(source).toContain("audioDubMode");
    expect(source).toContain("audioDubEmotion");
    expect(source).toContain("audioDubReplacementText");
    expect(source).toContain("Preserve performance");
    expect(source).toContain("Rewrite line");
    expect(source).toContain("modelPath: selectedVoice?.modelPath || selectedVoice?.path ||");
    expect(source).toContain("indexPath: selectedVoice?.indexPath ||");
    expect(source).toContain('engine: selectedVoice?.engine === "character" ? "applio"');
    expect(source).toContain("Generate Voice Swap");
    expect(source).toContain("Voice swap output");
    expect(source).toContain("voiceRow.sampleUrl");
    expect(source).toContain("Speaker detection:");
    expect(source).toContain("Rewrite Line uses AuK");
  });

  it("exposes voice dubbing controls in the Production V2 Audio Studios panel", () => {
    const source = read("app/app/components/ProductionV2Panel.tsx");

    expect(source).toContain('data-otg="production-v2-voice-dubbing"');
    expect(source).toContain('fetch("/api/voice/models"');
    expect(source).toContain('fetch("/api/production/audio/analyze-clip"');
    expect(source).toContain('fetch("/api/production/audio/dub-preview"');
    expect(source).toContain("Analyze Clip Audio");
    expect(source).toContain("Map to character voice");
    expect(source).toContain("Generate Voice Swap");
    expect(source).toContain("Voice swap output");
  });
});
