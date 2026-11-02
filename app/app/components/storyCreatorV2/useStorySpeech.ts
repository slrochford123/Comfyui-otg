"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultStoryVoice, isStoryLocalEngine, validStoryVoice, STORY_SPEECH_LABELS,
  type StorySpeechEngine as Engine, type StorySpeechVoice } from "@/lib/storyCreator/speechVoices";

type Capabilities = { transcription: boolean; available: boolean; engines: { paradee: boolean; kokoro: boolean; bark: boolean }; defaultEngine: Engine };
const unavailable: Capabilities = { transcription: false, available: false, engines: { paradee: false, kokoro: false, bark: false }, defaultEngine: "browser" };
const preferencesKey = "otg.storyCreator.speech.v1";

export function useStorySpeech(projectId: string) {
  const [capabilities, setCapabilities] = useState(unavailable);
  const [engine, setEngineState] = useState<Engine>("browser");
  const [voice, setVoiceState] = useState<StorySpeechVoice>("female");
  const voicesRef = useRef<Partial<Record<Engine, StorySpeechVoice>>>({});
  const [status, setStatus] = useState("");
  const [messageId, setMessageId] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [preparedMessageId, setPreparedMessageId] = useState("");
  const [failedMessageId, setFailedMessageId] = useState("");
  const [preparing, setPreparing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const jobRef = useRef<string>("");
  const selectionRef = useRef("");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audioUrl || !audio) return;
    audio.onended = () => setMessageId("");
    audio.onerror = () => { setStatus("Could not load cached speech. The written reply is unchanged."); setMessageId(""); setFailedMessageId(preparedMessageId); };
    audio.onplay = () => setMessageId(preparedMessageId);
    void audio.play().then(() => setStatus(`${engine === "browser" ? "Device voice" : STORY_SPEECH_LABELS[engine]} · local CPU playback`))
      .catch(() => { setStatus("Audio is ready. Tap the audio player's Play button to listen."); setMessageId(""); });
    return () => { audio.pause(); audio.onended = null; audio.onerror = null; audio.onplay = null; };
  }, [audioUrl, preparedMessageId, engine]);

  const stop = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    if (jobRef.current) void fetch("/api/story-creator/speech", { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", projectId, jobId: jobRef.current }) }).catch(() => {});
    jobRef.current = "";
    setMessageId(""); setPreparing(false);
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    let preference: { engine?: Engine; voice?: StorySpeechVoice; voices?: Partial<Record<Engine, StorySpeechVoice>> } = {};
    try { preference = JSON.parse(localStorage.getItem(preferencesKey) || "{}") || {}; } catch { /* UI preference only */ }
    voicesRef.current = {};
    for (const selected of ["paradee", "kokoro", "bark"] as const) {
      const saved = preference.voices?.[selected] ?? (preference.engine === selected ? preference.voice : undefined);
      if (validStoryVoice(selected, saved)) voicesRef.current[selected] = saved;
    }
    setPreparing(false); setMessageId(""); setFailedMessageId(""); selectionRef.current = "";
    setCapabilities(unavailable); setStatus(""); setAudioUrl(""); setPreparedMessageId("");
    void fetch(`/api/story-creator/speech?projectId=${encodeURIComponent(projectId)}`,
      { credentials: "include", cache: "no-store", signal: controller.signal }).then(async response => {
        if (!response.ok) return;
        const data = await response.json();
        if (controller.signal.aborted) return;
        const next = data.capabilities as Capabilities;
        setCapabilities(next);
        const desired = preference.engine || next.defaultEngine;
        const selected = desired === "browser" || (isStoryLocalEngine(desired) && next.engines[desired]) ? desired : "browser";
        setEngineState(selected);
        setVoiceState(voicesRef.current[selected] || defaultStoryVoice(selected));
        if (selected !== desired) setStatus("Your selected local engine is unavailable. Device voice is selected; no paid voice service will be used.");
      }).catch(() => {});
    return () => {
      controller.abort(); requestRef.current?.abort();
      jobRef.current = "";
      // Leaving the page does not cancel an already accepted server-owned speech job.
    };
  }, [projectId]);

  function persist(nextEngine: Engine, nextVoice: StorySpeechVoice) {
    voicesRef.current[nextEngine] = nextVoice;
    try { localStorage.setItem(preferencesKey, JSON.stringify({ engine: nextEngine, voice: nextVoice, voices: voicesRef.current })); } catch { /* preference only */ }
  }
  function clearPreparedAudio() {
    setAudioUrl(""); setPreparedMessageId(""); setFailedMessageId(""); setStatus("");
  }
  function setEngine(value: Engine) {
    if (value !== "browser" && (!isStoryLocalEngine(value) || !capabilities.engines[value])) return;
    stop(); clearPreparedAudio();
    const nextVoice = voicesRef.current[value] || defaultStoryVoice(value);
    setEngineState(value); setVoiceState(nextVoice); persist(value, nextVoice);
  }
  function setVoice(value: StorySpeechVoice) {
    if (!validStoryVoice(engine, value)) return;
    stop(); clearPreparedAudio(); setVoiceState(value); persist(engine, value);
  }

  async function play(sourceMessageId: string, retry = false) {
    const selection = JSON.stringify([projectId, sourceMessageId, engine, voice]);
    // Retrying an interrupted connection rejoins the same deduplicated job.
    // It must not cancel an accepted server job merely to reconnect to it.
    if (selectionRef.current !== selection) stop();
    else { requestRef.current?.abort(); audioRef.current?.pause(); }
    selectionRef.current = selection;
    if (engine === "browser") return;
    const controller = new AbortController(); requestRef.current = controller;
    setAudioUrl(""); setPreparedMessageId(""); setFailedMessageId("");
    setMessageId(sourceMessageId); setPreparing(true); setStatus("Preparing local speech…");
    try {
      const response = await fetch("/api/story-creator/speech", { method: "POST", credentials: "include",
        signal: controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, messageId: sourceMessageId, engine, voice, retry }) });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data.error || "Could not prepare local speech.");
      const jobId = String(data.job.id); jobRef.current = jobId;
      const deadline = Date.now() + 900_000;
      while (!controller.signal.aborted && Date.now() < deadline) {
        const result = await fetch(`/api/story-creator/speech?projectId=${encodeURIComponent(projectId)}&jobId=${encodeURIComponent(jobId)}`,
          { credentials: "include", cache: "no-store", signal: controller.signal });
        const snapshot = await result.json();
        if (controller.signal.aborted) return;
        if (!result.ok) throw new Error(snapshot.error || "Could not reconnect to local speech.");
        if (snapshot.job.status === "completed" && snapshot.url) {
          jobRef.current = ""; setPreparing(false);
          setAudioUrl(snapshot.url); setPreparedMessageId(sourceMessageId);
          return;
        }
        if (["failed", "cancelled"].includes(snapshot.job.status)) throw new Error(snapshot.job.error || "Local speech was cancelled. Choose Retry voice to try again.");
        setStatus(snapshot.job.status === "queued" ? "Local speech queued…" : engine === "bark"
          ? "Bark is generating on CPU. This experimental voice can take over a minute." : "Generating local speech…");
        await new Promise<void>((resolve, reject) => {
          const done = () => { controller.signal.removeEventListener("abort", abort); resolve(); };
          const timer = setTimeout(done, 750);
          const abort = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
          controller.signal.addEventListener("abort", abort, { once: true });
        });
      }
      if (!controller.signal.aborted) throw new Error("Playback is taking too long. Your written reply is saved.");
    } catch (error) {
      if (!controller.signal.aborted) { setStatus(error instanceof Error ? error.message : "Local speech failed."); setFailedMessageId(sourceMessageId); }
      if (requestRef.current === controller) { setMessageId(""); setPreparing(false); }
    }
  }

  return { capabilities, engine, setEngine, voice, setVoice, status, messageId,
    preparing, audioUrl, preparedMessageId, failedMessageId, audioRef, play, stop };
}
