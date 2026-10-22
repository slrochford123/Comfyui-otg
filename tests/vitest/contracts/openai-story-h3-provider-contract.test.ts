import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("OpenAI Storyteller and H3 Director provider contract", () => {
  it("keeps OpenAI credentials server-side with shared controls and usage tracking", () => {
    const provider = read("lib/openai/provider.ts");

    expect(provider).toContain('import OpenAI, { toFile } from "openai"');
    expect(provider).toContain("process.env.OPENAI_API_KEY");
    expect(provider).toContain("OPENAI_KILL_SWITCH");
    expect(provider).toContain("OPENAI_H3_MODEL");
    expect(provider).toContain("OPENAI_STORY_MODEL");
    expect(provider).toContain("OPENAI_TRANSCRIBE_MODEL");
    expect(provider).toContain("OPENAI_DAILY_USER_COST_LIMIT_USD");
    expect(provider).toContain("OPENAI_DAILY_GLOBAL_COST_LIMIT_USD");
    expect(provider).toContain("OPENAI_RATE_LIMIT_PER_MINUTE");
    expect(provider).toContain("usage.json");
    expect(provider).toContain("responses.create");
    expect(provider).toContain("audio.transcriptions.create");
  });

  it("routes Story Helper and Story Creator Write through OpenAI first with Qwen rollback", () => {
    const chat = read("app/api/ollama-ai/chat/route.ts");
    const write = read("app/api/story-creator/write/route.ts");
    const panel = read("app/app/components/StoryCreatorPanel.tsx");
    const context = read("lib/storyCreator/context.ts");

    expect(chat).toContain("openAIEnabled()");
    expect(chat).toContain('useCase: "story-helper"');
    expect(chat).toContain("openAIModels().story");
    expect(chat).toContain("provider: \"openai\"");
    expect(chat).toContain("qwenFetchForChatRequest");
    expect(chat).toContain("You are Story Helper inside the SLR Studios OTG app.");
    expect(chat).toContain("buildStoryDirectorProjectContext");
    expect(chat).toContain("PERSISTENT PROJECT CONTEXT");
    expect(chat).toContain('status === 401');
    expect(chat).toContain('"STORY_UNAUTHORIZED"');
    expect(chat).toContain('"STORY_OPENAI_LIMIT"');
    expect(panel).toContain("projectId: project.id");
    expect(context).toContain("APPROVED CANON - authoritative");
    expect(context).toContain("PROPOSED DETAILS - not canon");

    expect(write).toContain('useCase: "story-write"');
    expect(write).toContain("Write only from approved canon supplied by the app.");
    expect(write).toContain("qwenDurableFetch");
  });

  it("uses gpt-transcribe through the shared endpoint while preserving local Whisper rollback", () => {
    const transcribe = read("app/api/ollama-ai/transcribe/route.ts");
    const ideas = read("app/app/components/storyCreatorV2/IdeasTab.tsx");
    const speech = read("app/app/components/SpeechInputButton.tsx");

    expect(transcribe).toContain("transcribeOpenAIAudio");
    expect(transcribe).toContain("OPENAI_TRANSCRIBE_FALLBACK_LOCAL");
    expect(transcribe).toContain("scripts/whisper/transcribe.py");
    expect(transcribe).toContain("requireSessionUser");
    expect(ideas).toContain("SpeechInputButton");
    expect(speech).toContain("context?: string");
    expect(speech).toContain('body.set("context", context)');
    expect(speech).toContain("/api/ollama-ai/transcribe");
    expect(speech).toContain('body.set("durationSeconds"');
    expect(transcribe).toContain("buildTranscriptionPrompt");
  });

  it("adds an H3 AI Director that updates prompts without changing advanced controls", () => {
    const route = read("app/api/openai-ai/h3-director/route.ts");
    const panel = read("app/app/components/H3Panel.tsx");
    const persistence = read("app/app/components/h3InputPersistence.ts");
    const store = read("lib/openai/h3DirectorStore.ts");

    expect(route).toContain('useCase: "h3-director"');
    expect(route).toContain("openAIModels().h3");
    expect(route).toContain("Do not alter locked generation settings");
    expect(route).toContain("LoRAs:");
    expect(route).toContain("upsertH3DirectorConversation");
    expect(route).toContain("requireSessionUser");

    expect(panel).toContain('data-otg="h3-openai-director"');
    expect(panel).toContain("/api/openai-ai/h3-director");
    expect(panel).toContain("replaceOriginal(nextPrompt)");
    expect(panel).toContain("Prompt version history");
    expect(panel).toContain("h3DirectorConversationId");

    expect(persistence).toContain("h3DirectorPromptVersions");
    expect(store).toContain("promptVersions");
    expect(store).toContain("ownerKey");
  });
});

