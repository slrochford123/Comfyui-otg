import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(
    path.join(root, relativePath),
    "utf8",
  );
}

const ideas = read(
  "app/app/components/storyCreatorV2/IdeasTab.tsx",
);
const speechInput = read(
  "app/app/components/SpeechInputButton.tsx",
);

describe("Story Creator V2 microphone and speaker contract", () => {
  it("records microphone input through the shared OpenAI-first transcribe component", () => {
    expect(ideas).toContain("SpeechInputButton");
    expect(speechInput).toContain("navigator.mediaDevices.getUserMedia");
    expect(speechInput).toContain("new MediaRecorder");
    expect(speechInput).toContain("preferredAudioMimeType");
    expect(speechInput).toContain("MediaRecorder.isTypeSupported");
    expect(speechInput).toContain("/api/ollama-ai/transcribe");
    expect(ideas).toContain("Story Bible canon");
    expect(speechInput).toContain('body.set("audio"');
    expect(speechInput).toContain("recorder.start(1000)");
    expect(speechInput).toContain("recorder.requestData()");
    expect(speechInput).toContain("Transcribe recording");
    expect(speechInput).toContain("No microphone audio was captured.");
  });

  it("inserts transcript into the editable composer without auto-sending", () => {
    expect(ideas).toContain("mergeTranscriptDraft");
    expect(ideas).toContain("onDraftChange(mergeTranscriptDraft");
    expect(ideas).toContain("draft, text");
    expect(ideas).not.toContain("onSend(transcript");
    expect(ideas).not.toContain("void onSend");
    expect(speechInput).toContain("Mic");
    expect(speechInput).toContain("Stop Mic");
    expect(speechInput).toContain("Transcribing...");
  });

  it("prevents double recording and handles permission failures nonfatally", () => {
    expect(speechInput).toContain('state === "listening"');
    expect(speechInput).toContain('state === "processing"');
    expect(speechInput).toContain("This browser does not support microphone capture.");
    expect(speechInput).toContain("Microphone access failed.");
    expect(speechInput).toContain("stopTracks");
    expect(speechInput).toContain("track.stop()");
  });

  it("keeps mobile recordings reviewable before transcription and sends diagnostics", () => {
    expect(speechInput).toContain("<audio controls");
    expect(speechInput).toContain('body.set("durationSeconds"');
    expect(speechInput).toContain('body.set("chunkCount"');
    expect(speechInput).toContain('body.set("clientMimeType"');
    expect(speechInput).toContain("Raw transcript added. Review and edit it before submitting.");
    expect(speechInput).not.toContain("onTranscript(text);\n          setState(\"idle\")");
  });

  it("adds assistant-only read-aloud with stop and speech normalization", () => {
    expect(ideas).toContain("normalizeStoryDirectorSpeechText");
    expect(ideas).toContain("SpeechSynthesisUtterance");
    expect(ideas).toContain("window.speechSynthesis.cancel");
    expect(ideas).toContain("window.speechSynthesis.speak");
    expect(ideas).toContain('item.role === "assistant" ?');
    expect(ideas).toContain('item.role === "user" ? "You" : "Story Director"');
    expect(ideas).toContain("speakingMessageId === item.id");
    expect(ideas).toContain("? \"Stop\"");
    expect(ideas).toContain(": \"Play\"");
  });

  it("stores only the Auto Speak UI preference and only speaks new assistant messages", () => {
    expect(ideas).toContain("Auto Speak Responses");
    expect(ideas).toContain("window.localStorage.setItem");
    expect(ideas).toContain("STORY_DIRECTOR_AUTO_SPEAK_KEY");
    expect(ideas).toContain("knownMessageIdsRef.current = currentIds");
    expect(ideas).toContain("newAssistantMessages");
    expect(ideas).toContain('message.role === "assistant"');
    expect(ideas).toContain("!previous.has(message.id)");
    expect(ideas).not.toContain("localStorage.setItem(\"storyMessages");
  });

  it("normalizes speech text without changing displayed assistant text", () => {
    expect(ideas).toContain("replace(/^#{1,6}");
    expect(ideas).toContain("replace(/`([^`]+)`/g");
    expect(ideas).toContain("replace(/^\\s*[-*+]\\s+/gm");
    expect(ideas).toContain("<div className=\"whitespace-pre-wrap\">");
    expect(ideas).toContain("{item.content}");
  });
});
