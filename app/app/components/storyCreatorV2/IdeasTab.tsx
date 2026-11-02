"use client";

import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import SpeechInputButton from "../SpeechInputButton";
import type { StoryVisualDirectorAction } from "@/lib/storyCreator/visualActions";
import { StoryDirectorVisualCard } from "./StoryDirectorVisualCard";
import { StoryMediaCards } from "./StoryMediaCards";
import { useStorySpeech } from "./useStorySpeech";
import { STORY_VOICES, type StorySpeechEngine, type StorySpeechVoice } from "@/lib/storyCreator/speechVoices";
import { normalizeStorySpeechText } from "@/lib/storyCreator/speechText";

type StoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type StoryOpenQuestion = {
  id: string;
  question: string;
  status: string;
  sourceRole: "user" | "assistant" | "system";
};

type Props = {
  projectId: string;
  projectTitle: string;
  vocabularyKeywords: string[];
  storyMessages: StoryMessage[];
  messagesLoading: boolean;
  chatBusy: boolean;
  chatError: string;
  activeReply?: { partialText: string; status: string } | null;
  onCancelReply?: () => void;
  draft: string;
  chatEndRef: RefObject<HTMLDivElement | null>;
  extractionBusy: boolean;
  extractionError: string;
  extractionNotice: string;
  canUndoMemory?: boolean;
  onUndoMemory?: () => void;
  extractionSourceMessageId: string;
  storyUsage: { costUsd: number; requestCount: number; status: "actual" | "partial" | "unavailable" };
  openQuestions: StoryOpenQuestion[];
  openQuestionsLoading: boolean;
  openQuestionsError: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onExtract: (sourceMessageId: string) => void;
  visualAction: StoryVisualDirectorAction | null;
  visualActionError: string;
  onMediaAvailability?: (enabled:boolean)=>void;
};

const STORY_DIRECTOR_AUTO_SPEAK_KEY =
  "otg.storyCreator.autoSpeakResponses";

function mergeTranscriptDraft(current: string, transcript: string) {
  const cleanTranscript = transcript.replace(/\s+/g, " ").trim();
  if (!cleanTranscript) return current;

  const cleanCurrent = current.trimEnd();
  if (!cleanCurrent) return cleanTranscript;

  return `${cleanCurrent}\n\n${cleanTranscript}`;
}

export function normalizeStoryDirectorSpeechText(value: string) {
  return normalizeStorySpeechText(value);
}

export function IdeasTab({
  projectId,
  projectTitle,
  vocabularyKeywords,
  storyMessages,
  messagesLoading,
  chatBusy,
  chatError,
  activeReply,
  onCancelReply,
  draft,
  chatEndRef,
  extractionBusy,
  extractionError,
  extractionNotice,
  canUndoMemory,
  onUndoMemory,
  extractionSourceMessageId,
  storyUsage,
  openQuestions,
  openQuestionsLoading,
  openQuestionsError,
  onDraftChange,
  onSend,
  onExtract,
  visualAction,
  visualActionError,
  onMediaAvailability,
}: Props) {
  const [recorderStatus, setRecorderStatus] = useState("");
  const speech = useStorySpeech(projectId);
  const [transcriptionProvider, setTranscriptionProvider] = useState<"local" | "openai">("local");
  const [dictationLanguage, setDictationLanguage] = useState("");
  const [translateSpeech, setTranslateSpeech] = useState(false);

  const [autoSpeakResponses, setAutoSpeakResponses] =
    useState(false);
  const [speakingMessageId, setSpeakingMessageId] =
    useState("");
  const knownMessageIdsRef = useRef<Set<string> | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(
    null,
  );

  useEffect(() => {
    try {
      setAutoSpeakResponses(
        window.localStorage.getItem(
          STORY_DIRECTOR_AUTO_SPEAK_KEY,
        ) === "1",
      );
    } catch {
      setAutoSpeakResponses(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      // Unmounting or changing projects stops device playback only. The speech
      // hook detaches polling; an accepted server job may finish for later replay.
      try { window.speechSynthesis?.cancel(); } catch { /* device voice unavailable */ }
      utteranceRef.current = null;
    };
  }, [projectId]);

  useEffect(() => {
    if (messagesLoading) { knownMessageIdsRef.current = null; return; }
    const currentIds = new Set(
      storyMessages.map((message) => message.id),
    );

    if (!knownMessageIdsRef.current) {
      knownMessageIdsRef.current = currentIds;
      return;
    }

    const previous = knownMessageIdsRef.current;
    const newAssistantMessages = storyMessages.filter(
      (message) =>
        message.role === "assistant" && !previous.has(message.id),
    );
    knownMessageIdsRef.current = currentIds;

    if (!autoSpeakResponses || !newAssistantMessages.length) {
      return;
    }

    const latest =
      newAssistantMessages[newAssistantMessages.length - 1];
    playAssistantMessage(latest.id, latest.content, {
      automatic: true,
    });
  }, [autoSpeakResponses, storyMessages, messagesLoading, projectId]);

  function setAutoSpeak(value: boolean) {
    setAutoSpeakResponses(value);
    try {
      window.localStorage.setItem(
        STORY_DIRECTOR_AUTO_SPEAK_KEY,
        value ? "1" : "0",
      );
    } catch {
      // UI preference only; ignore storage failure.
    }
  }

  function stopPlayback() {
    speech.stop();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // ignore browser speech shutdown errors
    }
    utteranceRef.current = null;
    setSpeakingMessageId("");
  }

  function playAssistantMessage(
    messageId: string,
    content: string,
    options: { automatic?: boolean } = {},
  ) {
    if (speech.engine !== "browser") {
      try { window.speechSynthesis?.cancel(); } catch { /* device voice may not be present */ }
      setSpeakingMessageId("");
      void speech.play(messageId);
      return;
    }
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      if (!options.automatic) {
         setRecorderStatus(
          "This browser does not support read-aloud playback.",
        );
      }
      return;
    }

    const text = normalizeStoryDirectorSpeechText(content);
    if (!text) return;

    stopPlayback();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => {
      if (utteranceRef.current === utterance) {
        utteranceRef.current = null;
        setSpeakingMessageId("");
      }
    };
    utterance.onerror = () => {
      if (utteranceRef.current === utterance) {
        utteranceRef.current = null;
        setSpeakingMessageId("");
      }
    };

    utteranceRef.current = utterance;
    setSpeakingMessageId(messageId);

    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch {
      utteranceRef.current = null;
      setSpeakingMessageId("");
      if (!options.automatic) {
         setRecorderStatus("Could not start read-aloud playback.");
      }
    }
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(240px,0.9fr)]">
      <section className="flex min-h-[620px] min-w-0 flex-col rounded-[24px] border border-cyan-300/15 bg-black/40">
        <div className="border-b border-white/10 p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/60">
            Story Director
          </p>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-black text-white">
              Story Director Conversation
            </h2>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-white/45">
                <input
                  type="checkbox"
                  checked={autoSpeakResponses}
                  onChange={(event) =>
                    setAutoSpeak(event.target.checked)
                  }
                  className="h-4 w-4 accent-cyan-300"
                />
                Auto Speak Responses
              </label>

              <span className="text-xs text-white/35">
                {storyMessages.length} saved messages
              </span>
            </div>
          </div>

          <p className="mt-2 text-xs leading-5 text-white/45">
            Talk naturally about the story, characters, scenes, or
            production. Your conversation stays with this project.
          </p>
          <p className="mt-2 text-xs font-bold text-cyan-100/55">
            Story AI Usage: {storyUsage.status === "unavailable"
              ? "Unavailable"
              : `$${storyUsage.costUsd.toFixed(storyUsage.costUsd > 0 && storyUsage.costUsd < 0.01 ? 6 : 2)}${storyUsage.status === "partial" ? " (project-attributed only)" : ""}`}
          </p>
          <details className="mt-3 text-xs text-white/65">
            <summary className="min-h-10 cursor-pointer py-2 font-bold">Voice settings</summary>
            <div className="flex flex-wrap gap-3 py-2">
              <label>Playback <select value={speech.engine} onChange={(event) => { stopPlayback(); speech.setEngine(event.target.value as StorySpeechEngine); }} className="ml-2 min-h-10 rounded-lg bg-slate-900 p-2">
                <option value="browser">Device voice</option>
                <option value="paradee" disabled={!speech.capabilities.engines.paradee}>Paradee 1.2 · fast local CPU</option>
                <option value="kokoro" disabled={!speech.capabilities.engines.kokoro}>Kokoro · local CPU</option>
                <option value="bark" disabled={!speech.capabilities.engines.bark}>Bark Small · experimental CPU</option>
              </select></label>
              {speech.engine !== "browser" ? <label>Voice <select value={speech.voice} onChange={(event) => speech.setVoice(event.target.value as StorySpeechVoice)} className="ml-2 min-h-10 rounded-lg bg-slate-900 p-2">{STORY_VOICES[speech.engine].map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label> : null}
              <label>Dictation <select value={transcriptionProvider} onChange={(event) => { setTranscriptionProvider(event.target.value as "local" | "openai"); if (event.target.value === "openai" && !dictationLanguage) setDictationLanguage("en"); }} className="ml-2 min-h-10 rounded-lg bg-slate-900 p-2">
                <option value="local" disabled={!speech.capabilities.transcription}>Whisper · local CPU</option><option value="openai">OpenAI · API usage</option>
              </select></label>
              <label>Language <select value={dictationLanguage} onChange={(event) => setDictationLanguage(event.target.value)} className="ml-2 min-h-10 rounded-lg bg-slate-900 p-2">{transcriptionProvider === "local" ? <option value="">Detect automatically</option> : null}<option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="pt">Portuguese</option></select></label>
              {transcriptionProvider === "local" ? <label className="flex items-center gap-2"><input type="checkbox" checked={translateSpeech} onChange={(event) => setTranslateSpeech(event.target.checked)} />Translate recording into English</label> : null}
            </div>
            {speech.engine === "bark" ? <p>Bark Small is experimental on CPU: slower playback preparation, possible wording changes, maximum 400 characters. It is not the storyteller or transcriber.</p> : null}
            {speech.engine === "paradee" ? <p>Paradee 1.2 reads replies in English using your saved voice choice. Local CPU only; no paid speech calls or rendering GPU use. It does not translate or change the written reply.</p> : null}
            {!speech.capabilities.transcription ? <p>Local dictation is not ready. Typed messages still work; choose OpenAI dictation explicitly if desired.</p> : null}
          </details>
          {speech.status ? <p role="status" className="mt-2 text-xs text-cyan-100/75">{speech.status}</p> : null}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {messagesLoading ? (
            <div className="text-sm text-white/45">
              Loading conversation...
            </div>
          ) : storyMessages.length ? (
            storyMessages.map((item) => (
              <div
                key={item.id}
                id={`story-message-${item.id}`}
                className={
                  item.role === "user"
                    ? "ml-auto max-w-[88%] break-words rounded-[18px] bg-cyan-300 px-4 py-3 text-sm leading-6 text-black"
                    : "mr-auto max-w-[92%] break-words rounded-[18px] border border-white/10 bg-white/[0.06] px-4 py-3 text-sm leading-6 text-white/82"
                }
                >
                <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.14em] opacity-55">
                  <span>
                    {item.role === "user" ? "You" : "Story Director"}
                  </span>

                  {item.role === "assistant" ? (
                    <button
                      type="button"
                      onClick={() =>
                        (speakingMessageId === item.id || speech.messageId === item.id)
                          ? stopPlayback()
                          : playAssistantMessage(
                              item.id,
                              item.content,
                            )
                      }
                      className="rounded-full border border-white/15 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/70 hover:bg-white/[0.08]"
                    >
                      {(speakingMessageId === item.id || speech.messageId === item.id)
                        ? "Stop"
                        : "Listen"}
                    </button>
                  ) : null}
                </div>

                <div className="whitespace-pre-wrap">
                  {item.content}
                </div>
                {speech.preparedMessageId === item.id && speech.audioUrl ? <audio ref={speech.audioRef} controls src={speech.audioUrl}
                  className="mt-2 h-10 max-w-full" aria-label="Story Director spoken reply" onPlay={() => { try { window.speechSynthesis?.cancel(); } catch { /* optional */ } }} /> : null}
                {item.role === "assistant" && speech.engine !== "browser" && speech.failedMessageId === item.id && !speech.preparing ? <button type="button"
                  onClick={() => void speech.play(item.id, true)} className="mt-1 min-h-10 text-xs text-white/45">Retry voice</button> : null}
              </div>
            ))
          ) : (
            <div className="rounded-[18px] border border-dashed border-white/10 bg-white/[0.025] p-5">
              <div className="font-black text-white">
                Start telling me your story.
              </div>

              <p className="mt-2 text-sm leading-6 text-white/52">
                You can describe characters, the world, scenes,
                relationships, problems, ideas, or simply talk
                naturally. This conversation will remain attached to
                this Story.
              </p>
            </div>
          )}

          {chatBusy ? (
            <div role="status" aria-live="polite" className="mr-auto whitespace-pre-wrap rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
              {activeReply?.partialText || "Story Director is thinking… Your message is saved."}
              {onCancelReply && activeReply ? <button type="button" onClick={onCancelReply}
                className="ml-3 min-h-10 rounded-xl border border-white/15 px-3 text-xs">Stop reply</button> : null}
            </div>
          ) : null}

          <StoryMediaCards key={projectId} projectId={projectId} onAvailability={onMediaAvailability}/>
          <div ref={chatEndRef} />
        </div>

        {visualAction ? <StoryDirectorVisualCard key={[visualAction.action, visualAction.assetId || "new", visualAction.sourceVersionId || "source", visualAction.displayVersionId || "pending", visualAction.prompt].join(":")} projectId={projectId} action={visualAction} onChange={(value) => onDraftChange(value)} /> : null}

        {visualActionError ? (
          <div className="mx-4 mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
            {visualActionError}
          </div>
        ) : null}

        <div className="border-t border-white/10 p-4">
          {chatError ? (
            <div className="mb-3 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
              {chatError}
            </div>
          ) : null}

          {recorderStatus ? (
            <div className="mb-3 rounded-[14px] border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs leading-5 text-cyan-100/80">
              {recorderStatus}
            </div>
          ) : null}

          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey)
              ) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder="Tell the Story Director what happens next..."
            rows={4}
            disabled={chatBusy}
            className="w-full resize-y rounded-[16px] border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-cyan-300/40 disabled:opacity-60"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <SpeechInputButton
                label="Record Story Director voice note"
                disabled={chatBusy || (transcriptionProvider === "local" && !speech.capabilities.transcription)}
                endpoint={transcriptionProvider === "local" ? `/api/story-creator/transcribe${translateSpeech ? "?translate=en" : ""}` : undefined}
                language={dictationLanguage}
                onRecordingStart={stopPlayback}
                className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white/70 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                projectId={projectId}
                context={`Story Creator project "${projectTitle}", Story Bible canon, active character names, worldbuilding, dialogue, scenes, screenplay, SLR Studios.`}
                vocabularyKeywords={vocabularyKeywords}
                onStatus={setRecorderStatus}
                onTranscript={(text) =>
                  onDraftChange(mergeTranscriptDraft(draft, text))
                }
              />
              <span className="text-[11px] text-white/35">
                Ctrl/Cmd + Enter to send
              </span>
            </div>

            <button
              type="button"
              disabled={chatBusy || !draft.trim()}
              onClick={onSend}
              className="rounded-[14px] bg-cyan-300 px-5 py-2.5 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {chatBusy ? "Thinking..." : "Send"}
            </button>
          </div>
        </div>
      </section>

      <aside className="min-w-0 space-y-4">
        <section className="rounded-[24px] border border-cyan-300/15 bg-cyan-300/[0.04] p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/60">
            Story Memory
          </p>

          <p className="mt-2 text-sm leading-6 text-white/55">
            Clear story details can be saved with each completed reply.
            Only genuine contradictions need your decision. Open Story Memory to edit or view sources.
          </p>

          {extractionError ? (
            <div className="mt-3 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
              {extractionError}
            </div>
          ) : null}

          {extractionNotice ? (
            <div className="mt-3 rounded-[14px] border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs leading-5 text-cyan-100/80">
              {extractionNotice}
              {canUndoMemory ? <button type="button" onClick={onUndoMemory}
                className="ml-2 min-h-10 rounded-lg border border-cyan-200/20 px-3">Undo saved details</button> : null}
            </div>
          ) : null}

          <details className="mt-3 text-xs text-white/60">
            <summary className="min-h-10 cursor-pointer py-2 font-bold">Advanced memory review · API usage</summary>
            <p className="mt-1 leading-5">Optional deeper review of saved conversation. This makes an additional OpenAI request; it is not required for ordinary conversation.</p>
          <button
            type="button"
            disabled={
              extractionBusy ||
              messagesLoading ||
              chatBusy ||
              !extractionSourceMessageId
            }
            onClick={() => onExtract(extractionSourceMessageId)}
            className="mt-4 rounded-[14px] bg-cyan-300 px-4 py-2.5 text-sm font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {extractionBusy
              ? "Extracting..."
              : extractionError
                ? "Try Again"
                : "Review Story Details"}
          </button>
          </details>
        </section>

        <details open={openQuestions.length > 0 || Boolean(openQuestionsError)} className="rounded-[24px] border border-white/10 bg-black/35 p-5">
          <summary className="min-h-10 cursor-pointer text-sm font-bold text-white/75">Story Gaps · Open Questions ({openQuestions.length})</summary>

          {openQuestionsError ? (
            <div className="mt-3 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100/80">
              {openQuestionsError}
            </div>
          ) : null}

          {openQuestionsLoading ? (
            <div className="mt-3 text-sm text-white/45">
              Loading questions...
            </div>
          ) : openQuestions.length ? (
            <div className="mt-3 space-y-2">
              {openQuestions.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[14px] border border-white/10 bg-white/[0.04] p-3"
                >
                  <div className="text-xs leading-5 text-white/72">
                    {item.question}
                  </div>

                  <div className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/32">
                    {item.sourceRole}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-white/55">
              Future story gaps and decisions will collect here after
              extraction finds them.
            </p>
          )}
        </details>

      </aside>
    </div>
  );
}
