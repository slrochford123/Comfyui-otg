"use client";

// OTG_VOICE_TEXT_TO_SPEECH_INDEXTTS2_V1

import React from "react";

type VoiceModel = {
  id: string;
  name: string;
  engine: "seed-vc" | "xtts" | "reference" | "character";
  path: string;
  displayPath: string;
  samplePath?: string;
  usable: boolean;
  notes?: string;
};

type TtsResult = {
  jobId: string;
  fileName: string;
  url: string;
  engine?: string;
  modelName?: string;
  saved?: boolean;
  message?: string;
};

type TtsProvider = "indextts2" | "omnivoice";

const EMOTION_PRESETS = [
  "angry but controlled",
  "grieving and broken",
  "calm, wise, fatherly",
  "intense villain monologue",
  "excited and energetic",
  "fearful but trying to stay brave",
  "soft, emotional, heartfelt",
  "cold, threatening, quiet intensity",
];

function cleanName(value: string) {
  return (
    String(value || "character_text_to_speech")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-zA-Z0-9._ -]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "character_text_to_speech"
  );
}

function withDownload(url: string) {
  if (!url) return "#";
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

export default function CharacterTextToSpeechPanel({
  onSaved,
}: {
  onSaved?: () => void;
}) {
  const [models, setModels] = React.useState<VoiceModel[]>([]);
  const [modelsBusy, setModelsBusy] = React.useState(false);
  const [modelsError, setModelsError] = React.useState("");
  const [selectedModelId, setSelectedModelId] = React.useState("");
  const [voiceSampleFile, setVoiceSampleFile] = React.useState<File | null>(null);
  const [voiceSampleUrl, setVoiceSampleUrl] = React.useState("");
  const [dialogue, setDialogue] = React.useState("I need you to listen carefully. This is not just a line. This is a performance.");
  const [provider, setProvider] = React.useState<TtsProvider>("indextts2");
  const [emotion, setEmotion] = React.useState("calm, wise, fatherly");
  const [language, setLanguage] = React.useState("en");
  const [speed, setSpeed] = React.useState(1);
  const [emotionStrength, setEmotionStrength] = React.useState(0.8);
  const [styleStrength, setStyleStrength] = React.useState(0.8);
  const [seed, setSeed] = React.useState("");
  const [title, setTitle] = React.useState("character_tts");
  const [busy, setBusy] = React.useState(false);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [result, setResult] = React.useState<TtsResult | null>(null);

  const selectedModel = React.useMemo(
    () => models.find((item) => item.id === selectedModelId) || null,
    [models, selectedModelId],
  );

  const loadModels = React.useCallback(async () => {
    setModelsBusy(true);
    setModelsError("");
    try {
      const response = await fetch("/api/voice/models", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Voice scan failed.");
      const items = Array.isArray(data?.items) ? data.items : [];
      const usable = items.filter((item: VoiceModel) => item.usable && (item.samplePath || item.path));
      setModels(usable);
      setSelectedModelId((current) => current || usable[0]?.id || "");
    } catch (error: any) {
      setModelsError(error?.message || "Voice scan failed.");
    } finally {
      setModelsBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void loadModels();
    return () => {
      if (voiceSampleUrl.startsWith("blob:")) URL.revokeObjectURL(voiceSampleUrl);
    };
  }, [loadModels, voiceSampleUrl]);

  function setVoiceSampleInput(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(file.name)) {
      setStatus("Select an audio file for the voice sample.");
      return;
    }
    if (voiceSampleUrl.startsWith("blob:")) URL.revokeObjectURL(voiceSampleUrl);
    setVoiceSampleFile(file);
    setVoiceSampleUrl(URL.createObjectURL(file));
    setResult(null);
    setStatus("Manual voice sample loaded for this TTS job.");
  }

  async function generateSpeech() {
    if (!dialogue.trim()) return setStatus("Enter dialogue text first.");
    if (!voiceSampleFile && !selectedModel) return setStatus("Select a character voice or upload a voice sample.");

    const form = new FormData();
    form.append("text", dialogue.trim());
    form.append("provider", provider);
    form.append("emotion", emotion.trim());
    form.append("language", language.trim() || "en");
    form.append("speed", String(speed));
    form.append("emotion_strength", String(emotionStrength));
    form.append("style_strength", String(styleStrength));
    form.append("seed", seed.trim());
    form.append("title", cleanName(title));
    if (voiceSampleFile) form.append("voice_upload", voiceSampleFile, voiceSampleFile.name);
    if (selectedModel) {
      form.append("voice_id", selectedModel.id);
      form.append("voice_path", selectedModel.path);
      form.append("voice_sample_path", selectedModel.samplePath || "");
      form.append("model_name", selectedModel.name);
    }

    setBusy(true);
    setResult(null);
    setStatus(`Generating expressive character speech with ${provider === "omnivoice" ? "OmniVoice" : "IndexTTS2"}...`);
    try {
      const response = await fetch("/api/voice/tts", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Text-to-Speech failed.");
      setResult({
        jobId: String(data.jobId || ""),
        fileName: String(data.fileName || "character_tts.wav"),
        url: String(data.url || ""),
        engine: String(data.engine || provider),
        modelName: String(data.modelName || selectedModel?.name || "Manual voice sample"),
        message: String(data.message || ""),
      });
      setStatus(data?.message || "Text-to-Speech audio is ready.");
    } catch (error: any) {
      setStatus(error?.message || "Text-to-Speech failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveToGallery() {
    if (!result?.jobId || !result.fileName) return;
    setSaveBusy(true);
    setStatus("Saving TTS audio to Gallery...");
    try {
      const response = await fetch("/api/voice/tts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: result.jobId,
          fileName: result.fileName,
          title: cleanName(title),
          engine: result.engine || provider,
          modelName: result.modelName || selectedModel?.name || "Manual voice sample",
          emotion,
          language,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Save to Gallery failed.");
      setResult((current) => (current ? { ...current, saved: true } : current));
      setStatus("Saved to Gallery.");
      onSaved?.();
    } catch (error: any) {
      setStatus(error?.message || "Save to Gallery failed.");
    } finally {
      setSaveBusy(false);
    }
  }

  function useInWorkflow() {
    if (!result?.url) return;
    window.dispatchEvent(
      new CustomEvent("otg:production-reference-audio", {
        detail: {
          url: result.url,
          fileName: result.fileName,
          title,
          source: "voice-text-to-speech",
        },
      }),
    );
    setStatus("TTS audio prepared for later workflow use.");
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-[22px] border border-cyan-400/15 bg-cyan-400/[0.04] p-4">
        <h3 className="text-sm font-black text-white">Character Text-to-Speech</h3>
        <p className="mt-2 text-sm leading-6 text-white/60">
          Type dialogue, choose a saved character voice or upload a manual sample, then pick IndexTTS2 or OmniVoice for script-driven expressive speech.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-black text-white">Step 1: Character voice</h4>
              <p className="mt-1 text-xs text-white/50">Saved Characters tab reference voices appear here.</p>
            </div>
            <button type="button" onClick={() => void loadModels()} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/75 hover:bg-white/10">
              Rescan
            </button>
          </div>
          <select
            value={selectedModelId}
            onChange={(event) => setSelectedModelId(event.target.value)}
            className="mt-3 w-full rounded-[18px] border border-white/10 bg-black/65 px-4 py-3 text-sm text-white outline-none"
          >
            {models.map((item) => (
              <option key={item.id} value={item.id}>{item.name} [{item.engine.toUpperCase()}]</option>
            ))}
          </select>
          {modelsBusy ? <p className="mt-2 text-xs text-white/45">Scanning voices...</p> : null}
          {modelsError ? <p className="mt-2 text-xs text-red-200/85">{modelsError}</p> : null}
          {selectedModel ? (
            <div className="mt-3 rounded-[18px] border border-white/10 bg-black/35 p-3 text-xs leading-5 text-white/58">
              <div className="font-semibold text-white/75">Loaded: {selectedModel.name}</div>
              <div className="break-all">{selectedModel.displayPath}</div>
              {selectedModel.notes ? <div className="mt-1 text-white/45">{selectedModel.notes}</div> : null}
            </div>
          ) : (
            <div className="mt-3 rounded-[18px] border border-white/10 bg-black/35 px-4 py-4 text-sm text-white/45">
              No saved character/reference voice found. Upload a manual voice sample below.
            </div>
          )}
        </div>

        <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
          <h4 className="text-sm font-black text-white">Optional voice sample override</h4>
          <p className="mt-2 text-xs text-white/50">Use this only when you do not want the selected character voice.</p>
          <label className="mt-3 inline-flex cursor-pointer rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-white hover:bg-white/10">
            Upload Voice Sample
            <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" className="hidden" onChange={(event) => setVoiceSampleInput(event.target.files?.[0] || null)} />
          </label>
          {voiceSampleUrl ? <audio src={voiceSampleUrl} controls preload="metadata" className="mt-3 w-full" /> : (
            <div className="mt-3 rounded-[18px] border border-white/10 bg-black/35 px-4 py-4 text-sm text-white/45">
              No manual override loaded.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
        <h4 className="text-sm font-black text-white">Step 2: Dialogue and performance</h4>
        <label className="mt-3 block text-xs font-black uppercase tracking-[0.18em] text-white/45">Dialogue</label>
        <textarea
          value={dialogue}
          onChange={(event) => setDialogue(event.target.value)}
          placeholder="Type the exact words the character should speak."
          className="mt-2 min-h-36 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"
        />
        <label className="mt-3 block text-xs font-black uppercase tracking-[0.18em] text-white/45">Emotion / performance instruction</label>
        <textarea
          value={emotion}
          onChange={(event) => setEmotion(event.target.value)}
          placeholder="Example: grieving and broken, but trying not to cry."
          className="mt-2 min-h-24 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {EMOTION_PRESETS.map((preset) => (
            <button key={preset} type="button" onClick={() => setEmotion(preset)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/10">
              {preset}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-6">
          <div>
            <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Provider</label>
            <select value={provider} onChange={(event) => setProvider(event.target.value as TtsProvider)} className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none">
              <option value="indextts2">IndexTTS2</option>
              <option value="omnivoice">OmniVoice</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Language</label>
            <input value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
          </div>
          <div>
            <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Speed</label>
            <input type="number" min="0.5" max="1.5" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value) || 1)} className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
          </div>
          <div>
            <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Emotion</label>
            <input type="number" min="0" max="1.5" step="0.05" value={emotionStrength} onChange={(event) => setEmotionStrength(Number(event.target.value) || 0)} className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
          </div>
          <div>
            <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Style</label>
            <input type="number" min="0" max="1.5" step="0.05" value={styleStrength} onChange={(event) => setStyleStrength(Number(event.target.value) || 0)} className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
          </div>
          <div>
            <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Seed</label>
            <input value={seed} onChange={(event) => setSeed(event.target.value.replace(/[^0-9-]/g, ""))} placeholder="random" className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <div>
            <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Output name</label>
            <input value={title} onChange={(event) => setTitle(cleanName(event.target.value))} className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
          </div>
          <button type="button" onClick={() => void generateSpeech()} disabled={busy || !dialogue.trim() || (!voiceSampleFile && !selectedModelId)} className="self-end rounded-full border border-cyan-400/20 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-50 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "Generating..." : "Generate Text-to-Speech"}
          </button>
        </div>
      </div>

      {status ? <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">{status}</div> : null}

      {result?.url ? (
        <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
          <h4 className="text-sm font-black text-white">Step 3: Preview generated speech</h4>
          <audio src={result.url} controls preload="metadata" className="mt-3 w-full" />
          <div className="mt-3 rounded-[18px] border border-white/10 bg-black/35 p-3 text-xs leading-5 text-white/58">
            <div>Engine: {result.engine || "indextts2"}</div>
            <div>Voice: {result.modelName || selectedModel?.name || "Manual voice sample"}</div>
            <div>File: {result.fileName}</div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={withDownload(result.url)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">Download</a>
            <button type="button" onClick={() => void saveToGallery()} disabled={saveBusy || result.saved} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50">
              {result.saved ? "Saved to Gallery" : saveBusy ? "Saving..." : "Save to Gallery"}
            </button>
            <button type="button" onClick={useInWorkflow} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-400/15">Use in workflow</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
