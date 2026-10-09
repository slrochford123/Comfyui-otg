"use client";

import * as React from "react";

type SpeechInputButtonProps = {
  label: string;
  onTranscript: (text: string) => void;
  className?: string;
  disabled?: boolean;
  endpoint?: string;
  appendMode?: "append" | "replace";
  currentText?: string;
  onStatus?: (message: string) => void;
};

function transcriptEndpoint(endpoint?: string) {
  return endpoint || "/api/ollama-ai/transcribe";
}

export default function SpeechInputButton({
  label,
  onTranscript,
  className,
  disabled = false,
  endpoint,
  onStatus,
}: SpeechInputButtonProps) {
  const [state, setState] = React.useState<"idle" | "listening" | "processing" | "error">("idle");
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const cancelRef = React.useRef(false);

  const stopTracks = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  React.useEffect(() => () => stopTracks(), [stopTracks]);

  async function transcribe(blob: Blob) {
    const body = new FormData();
    body.set("audio", new File([blob], `otg-${Date.now()}.webm`, { type: blob.type || "audio/webm" }));
    const response = await fetch(transcriptEndpoint(endpoint), {
      method: "POST",
      body,
      credentials: "include",
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.ok) {
      throw new Error(String(json?.detail || json?.error || "Transcription failed."));
    }
    const text = String(json?.text || "").trim();
    if (!text) throw new Error("No transcript returned.");
    return text;
  }

  async function toggle() {
    if (disabled || state === "processing") return;
    if (state === "listening") {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("error");
      onStatus?.("This browser does not support microphone capture.");
      return;
    }

    try {
      cancelRef.current = false;
      chunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      setState("listening");
      onStatus?.("Listening...");

      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        stopTracks();
        setState("error");
        onStatus?.("Microphone recording failed.");
      };
      recorder.onstop = async () => {
        const chunks = [...chunksRef.current];
        stopTracks();
        if (cancelRef.current) {
          setState("idle");
          onStatus?.("Recording canceled.");
          return;
        }
        if (!chunks.length) {
          setState("idle");
          onStatus?.("No audio captured.");
          return;
        }
        setState("processing");
        onStatus?.("Transcribing...");
        try {
          const text = await transcribe(new Blob(chunks, { type: "audio/webm" }));
          onTranscript(text);
          setState("idle");
          onStatus?.("Transcription added. You can edit it before submitting.");
        } catch (error) {
          setState("error");
          onStatus?.(error instanceof Error ? error.message : "Transcription failed.");
        }
      };
      recorder.start();
    } catch (error) {
      stopTracks();
      setState("error");
      onStatus?.(error instanceof Error ? error.message : "Microphone access failed.");
    }
  }

  function cancel() {
    cancelRef.current = true;
    recorderRef.current?.stop();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={disabled || state === "processing"}
        aria-label={state === "listening" ? `Stop ${label}` : label}
        className={className}
        data-otg="shared-speech-input"
      >
        {state === "listening" ? "Stop Mic" : state === "processing" ? "Transcribing..." : "Mic"}
      </button>
      {state === "listening" ? (
        <button type="button" onClick={cancel} className={className} aria-label={`Cancel ${label}`}>
          Cancel
        </button>
      ) : null}
    </span>
  );
}
