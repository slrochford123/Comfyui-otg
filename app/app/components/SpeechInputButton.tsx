"use client";

import * as React from "react";

type SpeechInputButtonProps = {
  label: string;
  onTranscript: (text: string) => void;
  className?: string;
  disabled?: boolean;
  endpoint?: string;
  context?: string;
  projectId?: string;
  vocabularyKeywords?: string[];
  language?: string;
  appendMode?: "append" | "replace";
  currentText?: string;
  onStatus?: (message: string) => void;
  onRecordingStart?: () => void;
  dictation?: {
    maxSeconds: number;
    autoSend: boolean;
    onSend: (text: string, id: string) => Promise<void>;
  };
};

type RecordingDraft = {
  id: string;
  autoSend: boolean;
  transcript?: { text: string; provider: string };
  blob: Blob;
  url: string;
  durationSeconds: number;
  chunkCount: number;
  mimeType: string;
};

const SUPPORTED_AUDIO_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

function transcriptEndpoint(endpoint?: string) {
  return endpoint || "/api/ollama-ai/transcribe";
}

function preferredAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    SUPPORTED_AUDIO_TYPES.find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) || ""
  );
}

function audioExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function formatElapsed(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export default function SpeechInputButton({
  label,
  onTranscript,
  className,
  disabled = false,
  endpoint,
  context,
  projectId,
  vocabularyKeywords,
  language = "en",
  onStatus,
  onRecordingStart,
  dictation,
}: SpeechInputButtonProps) {
  const [state, setState] = React.useState<"idle" | "listening" | "review" | "processing" | "sending" | "error">("idle");
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [recording, setRecording] = React.useState<RecordingDraft | null>(null);
  const [needsHttps,setNeedsHttps]=React.useState(false);
  const [originalTranscript, setOriginalTranscript] = React.useState("");
  React.useEffect(()=>{setNeedsHttps(window.isSecureContext===false);},[]);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const cancelRef = React.useRef(false);
  const startedAtRef = React.useRef(0);
  const elapsedTimerRef = React.useRef<number | null>(null);
  const limitTimerRef = React.useRef<number | null>(null);
  const mountedRef = React.useRef(false);
  const busyRef = React.useRef(false);
  const recordingOptionsRef = React.useRef(dictation);
  const callbacksRef = React.useRef({ onTranscript, onSend: dictation?.onSend });
  React.useEffect(() => {
    callbacksRef.current = { onTranscript, onSend: dictation?.onSend };
  }, [onTranscript, dictation]);
  const objectUrlRef = React.useRef("");
  const transcriptionAbortRef = React.useRef<AbortController | null>(null);

  const stopTracks = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const clearElapsedTimer = React.useCallback(() => {
    if (limitTimerRef.current != null) {
      window.clearTimeout(limitTimerRef.current);
      limitTimerRef.current = null;
    }
    if (elapsedTimerRef.current != null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const clearRecording = React.useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
    setRecording(null);
  }, []);

  React.useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        cancelRef.current = true;
        transcriptionAbortRef.current?.abort();
        clearElapsedTimer();
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        stopTracks();
      };
    },
    [clearElapsedTimer, stopTracks],
  );

  async function transcribe(draft: RecordingDraft) {
    const controller = new AbortController();
    transcriptionAbortRef.current = controller;
    const body = new FormData();
    const mimeType = draft.mimeType || draft.blob.type || "audio/webm";
    const fileName = `otg-${Date.now()}.${audioExtension(mimeType)}`;
    body.set("audio", new File([draft.blob], fileName, { type: mimeType }));
    body.set("durationSeconds", String(draft.durationSeconds));
    body.set("chunkCount", String(draft.chunkCount));
    body.set("clientMimeType", mimeType);
    if (projectId) body.set("projectId", projectId);
    if (language) body.set("language", language);
    if (context) body.set("context", context);
    const keywords = (vocabularyKeywords || [])
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .slice(0, 80);
    if (keywords.length) body.set("vocabulary", keywords.join(", "));
    const response = await fetch(transcriptEndpoint(endpoint), {
      method: "POST",
      body,
      credentials: "include",
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.ok) {
      throw new Error(String(json?.detail || json?.error || "Transcription failed."));
    }
    const text = String(json?.text || "").trim();
    if (controller.signal.aborted) throw new Error("Transcription cancelled. The recording and edited draft are unchanged.");
    if (!text) throw new Error("No transcript returned.");
    setOriginalTranscript(json.translatedInto === "en" ? String(json.originalText || "") : "");
    return { text, provider: String(json?.provider || "") };
  }

  function resetForNewRecording() {
    clearRecording();
    chunksRef.current = [];
    cancelRef.current = false;
    setElapsedSeconds(0);
  }

  function finishRecording(recorder: MediaRecorder) {
    return new Promise<RecordingDraft | null>((resolve, reject) => {
      let settled = false;
      const settle = (value: RecordingDraft | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        if (settled) return;
        settled = true;
        reject(new Error("Microphone recording failed before the audio could be saved."));
      };
      recorder.onstop = () => {
        clearElapsedTimer();
        stopTracks();
        if (cancelRef.current) {
          settle(null);
          return;
        }

        const chunks = [...chunksRef.current];
        const durationSeconds = Math.min(
          recordingOptionsRef.current?.maxSeconds ?? Infinity,
          Math.max(0, (Date.now() - startedAtRef.current) / 1000),
        );
        const mimeType = recorder.mimeType || preferredAudioMimeType() || "audio/webm";
        if (!chunks.length) {
          reject(new Error("No microphone audio was captured."));
          return;
        }

        const blob = new Blob(chunks, { type: mimeType });
        if (!blob.size || durationSeconds < 0.25) {
          reject(new Error("The recording was too short or incomplete. Please try again."));
          return;
        }

        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        settle({
          id: recordingOptionsRef.current?.autoSend ? crypto.randomUUID() : "",
          autoSend: Boolean(recordingOptionsRef.current?.autoSend),
          blob,
          url,
          durationSeconds,
          chunkCount: chunks.length,
          mimeType,
        });
      };

      try {
        if (recorder.state === "recording" && typeof recorder.requestData === "function") {
          recorder.requestData();
        }
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async function stopRecording(cancel = false) {
    if (busyRef.current) return;
    clearElapsedTimer();
    const recorder = recorderRef.current;
    cancelRef.current = cancel;
    if (!recorder || recorder.state === "inactive") {
      clearElapsedTimer();
      stopTracks();
      setState(cancel ? "idle" : "error");
      if (!cancel) onStatus?.("Recording was interrupted before it could be saved.");
      return;
    }

    busyRef.current = true;
    try {
      const draft = await finishRecording(recorder);
      busyRef.current = false;
      if (!mountedRef.current) return;
      if (cancel || !draft) {
        clearRecording();
        setState("idle");
        onStatus?.("Recording canceled.");
        return;
      }
      setRecording(draft);
      if (recordingOptionsRef.current) {
        await submitRecording(draft);
        return;
      }
      setState("review");
      onStatus?.(
        `Recorded ${draft.durationSeconds.toFixed(1)}s in ${draft.chunkCount} audio chunk${draft.chunkCount === 1 ? "" : "s"}. Play it back, then transcribe.`,
      );
    } catch (error) {
      busyRef.current = false;
      if (!mountedRef.current) return;
      clearElapsedTimer();
      stopTracks();
      clearRecording();
      setState("error");
      onStatus?.(error instanceof Error ? error.message : "Recording could not be saved.");
    }
  }

  async function submitRecording(draft = recording) {
    if (!draft || busyRef.current) return;
    busyRef.current = true;
    try {
      if (!draft.transcript) {
        setState("processing");
        onStatus?.(`Transcribing ${formatElapsed(draft.durationSeconds)} of audio…`);
        draft.transcript = await transcribe(draft);
        transcriptionAbortRef.current = null;
      }
      if (!mountedRef.current) return;
      if (draft.autoSend) {
        setState("sending");
        onStatus?.("Sending transcript to the Story Director…");
        const send = callbacksRef.current.onSend;
        if (!send) throw new Error("Automatic dictation send is unavailable.");
        await send(draft.transcript.text, draft.id);
      } else {
        callbacksRef.current.onTranscript(draft.transcript.text);
      }
      if (!mountedRef.current) return;
      clearRecording();
      setState("idle");
      const provider = draft.transcript.provider === "parakeet" ? " with Parakeet"
        : draft.transcript.provider === "openai" ? " with OpenAI" : "";
      onStatus?.(draft.autoSend ? `Transcribed${provider} and sent.` : "Transcript added to the composer. Review and send when ready.");
    } catch (error) {
      if (!mountedRef.current) return;
      setState("review");
      onStatus?.(error instanceof Error ? error.message : "Transcription failed.");
    } finally {
      transcriptionAbortRef.current = null;
      busyRef.current = false;
    }
  }

  async function toggle() {
    if (busyRef.current) return;
    if (state === "listening") {
      void stopRecording();
      return;
    }
    if (disabled) return;
    if(window.isSecureContext===false){
      setState("error");
      onStatus?.("Microphone recording requires HTTPS. Open this app using its secure HTTPS address, then try again.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("error");
      onStatus?.("This browser does not support microphone capture.");
      return;
    }

    busyRef.current = true;
    try {
      resetForNewRecording();
      recordingOptionsRef.current = dictation;
      onRecordingStart?.();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = preferredAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setState("listening");
      onStatus?.(dictation ? "Recording. The mic stops automatically at ten minutes." : "Recording. Tap Stop Mic when finished.");

      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        clearElapsedTimer();
        stopTracks();
        setState("error");
        onStatus?.("Microphone recording failed.");
      };
      recorder.start(1000);
      elapsedTimerRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - startedAtRef.current) / 1000;
        setElapsedSeconds(Math.min(elapsed, dictation?.maxSeconds ?? Infinity));
        if (dictation && elapsed >= dictation.maxSeconds) void stopRecording();
      }, 250);
      if (dictation) {
        limitTimerRef.current = window.setTimeout(() => void stopRecording(), dictation.maxSeconds * 1000);
      }
    } catch (error) {
      clearElapsedTimer();
      stopTracks();
      setState("error");
      if (mountedRef.current) onStatus?.(error instanceof Error ? error.message : "Microphone access failed.");
    } finally {
      busyRef.current = false;
    }
  }

  function cancel() {
    void stopRecording(true);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-otg="shared-speech-input">
      {state !== "review" ? (
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={(disabled && state !== "listening") || state === "processing" || state === "sending"}
          aria-label={needsHttps?"Microphone requires HTTPS":state === "listening" ? `Stop ${label}` : label}
          title={needsHttps?"Open the secure HTTPS app address to record audio.":undefined}
          className={className}
        >
          {needsHttps?"Mic · HTTPS required":state === "listening" ? (recordingOptionsRef.current?.autoSend ? "Stop & Send" : "Stop Mic") : state === "processing" ? "Transcribing..." : state === "sending" ? "Sending..." : "Mic"}
        </button>
      ) : null}
      {state === "listening" ? (
        <button type="button" onClick={cancel} className={className} aria-label={`Cancel ${label}`}>
          Cancel
        </button>
      ) : null}
      {state === "processing" ? <button type="button" className={className}
        onClick={() => transcriptionAbortRef.current?.abort()}>Cancel transcription</button> : null}
      {state === "listening" ? (
        <span className="rounded-full border border-red-300/25 bg-red-400/10 px-2 py-1 text-xs font-black text-red-50">
          Recording {formatElapsed(elapsedSeconds)}{dictation ? ` / ${formatElapsed(dictation.maxSeconds)}` : ""}
        </span>
      ) : null}
      {state === "review" && recording ? (
        <span className="inline-flex flex-wrap items-center gap-2 rounded-[8px] border border-white/10 bg-black/25 p-2">
          <audio controls src={recording.url} className="h-9 max-w-[220px]" />
          <span className="text-xs text-white/55">
            {recording.durationSeconds.toFixed(1)}s · {recording.chunkCount} chunk{recording.chunkCount === 1 ? "" : "s"}
          </span>
          <button type="button" onClick={() => void submitRecording()} className={className} disabled={disabled}>
            {recording.transcript ? "Retry send" : "Transcribe recording"}
          </button>
          <button
            type="button"
            onClick={() => {
              clearRecording();
              setState("idle");
              onStatus?.("Recording discarded. Edited text was preserved.");
            }}
            className={className}
          >
            {dictation ? "Discard recording" : "Retry"}
          </button>
        </span>
      ) : null}
      {originalTranscript ? <details className="basis-full rounded-lg border border-white/10 p-2 text-xs text-white/65">
        <summary className="min-h-10 cursor-pointer py-2">Original-language transcript</summary>
        <span className="block whitespace-pre-wrap py-2">{originalTranscript}</span>
      </details> : null}
    </span>
  );
}
