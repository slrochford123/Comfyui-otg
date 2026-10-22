import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("OpenAI transcription recording integrity contract", () => {
  it("waits for final browser audio data before allowing transcription", () => {
    const speech = read("app/app/components/SpeechInputButton.tsx");

    expect(speech).toContain("recorder.start(1000)");
    expect(speech).toContain("recorder.requestData()");
    expect(speech).toContain("finishRecording(recorder)");
    expect(speech).toContain("onstop = () =>");
    expect(speech).toContain("chunkCount: chunks.length");
    expect(speech).toContain("durationSeconds");
    expect(speech).toContain("<audio controls");
    expect(speech).toContain("Transcribe recording");
  });

  it("uploads the browser-supported audio format and diagnostic metadata", () => {
    const speech = read("app/app/components/SpeechInputButton.tsx");
    const route = read("app/api/ollama-ai/transcribe/route.ts");

    expect(speech).toContain("SUPPORTED_AUDIO_TYPES");
    expect(speech).toContain("audio/webm;codecs=opus");
    expect(speech).toContain("audio/mp4");
    expect(speech).toContain('body.set("clientMimeType"');
    expect(speech).toContain('body.set("durationSeconds"');
    expect(speech).toContain('body.set("chunkCount"');

    expect(route).toContain("uploadedBytes");
    expect(route).toContain("clientDurationSeconds");
    expect(route).toContain("chunkCount");
    expect(route).toContain("clientMimeType");
    expect(route).toContain("vocabularyHintCount");
  });

  it("preserves raw transcription separately from prompt rewriting and uses vocabulary hints", () => {
    const route = read("app/api/ollama-ai/transcribe/route.ts");
    const provider = read("lib/openai/provider.ts");
    const h3 = read("app/app/components/H3Panel.tsx");
    const story = read("app/app/components/storyCreatorV2/IdeasTab.tsx");

    expect(route).toContain("Transcribe the user's speech verbatim in English");
    expect(route).toContain("Do not summarize, rewrite, invent missing words");
    expect(route).toContain("BASE_TRANSCRIPTION_VOCABULARY");
    expect(route).toContain("storyProjectVocabulary");
    expect(provider).toContain("languages: args.language ? [args.language] : undefined");
    expect(h3).toContain("h3VoiceVocabularyKeywords");
    expect(story).toContain("vocabularyKeywords={vocabularyKeywords}");
  });
});
