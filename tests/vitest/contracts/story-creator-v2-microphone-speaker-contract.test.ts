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

describe("Story Creator V2 microphone and speaker contract", () => {
  it("records microphone input through MediaRecorder and reuses the existing Whisper route", () => {
    expect(ideas).toContain("navigator.mediaDevices.getUserMedia");
    expect(ideas).toContain("new MediaRecorder");
    expect(ideas).toContain("preferredAudioMimeType");
    expect(ideas).toContain("MediaRecorder.isTypeSupported");
    expect(ideas).toContain("/api/whisper/transcribe");
    expect(ideas).toContain('formData.append(\n      "audio"');
    expect(ideas).toContain('recorderState === "recording"');
    expect(ideas).toContain('recorderState === "transcribing"');
    expect(ideas).toContain("No microphone audio was captured.");
  });

  it("inserts transcript into the editable composer without auto-sending", () => {
    expect(ideas).toContain("mergeTranscriptDraft");
    expect(ideas).toContain("onDraftChange(mergeTranscriptDraft");
    expect(ideas).toContain("draft, transcript");
    expect(ideas).not.toContain("onSend(transcript");
    expect(ideas).not.toContain("void onSend");
    expect(ideas).toContain("Microphone");
    expect(ideas).toContain("Stop");
    expect(ideas).toContain("Transcribing...");
  });

  it("prevents double recording and handles permission failures nonfatally", () => {
    expect(ideas).toContain('recorderState === "recording"');
    expect(ideas).toContain('recorderState === "transcribing"');
    expect(ideas).toContain("This browser does not support microphone recording.");
    expect(ideas).toContain("Microphone permission was denied or unavailable.");
    expect(ideas).toContain("cleanupRecorder");
    expect(ideas).toContain("track.stop()");
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
