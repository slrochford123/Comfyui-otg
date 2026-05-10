"use client";

// OTG_QWEN3_TTS_VIDEO_DUB_OPTION_V11
// OTG_VOICE_TEXT_TO_SPEECH_INDEXTTS2_V1

import React from "react";
import CharacterTextToSpeechPanel from "./CharacterTextToSpeechPanel";

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

type AudioDubResult = {
  jobId: string;
  fileName: string;
  url: string;
  saved?: boolean;
  engine?: string;
  modelName?: string;
  message?: string;
};

type VideoDubResult = {
  jobId: string;
  fileName: string;
  url: string;
  transcript?: string;
  saved?: boolean;
  mode?: string;
  ttsEngine?: string;
  message?: string;
};

type VideoTtsEngine = "xtts" | "qwen3" | "omnivoice";

function cleanName(value: string) {
  return (
    String(value || "voice_dub")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-zA-Z0-9._ -]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "voice_dub"
  );
}

function withDownload(url: string) {
  if (!url) return "#";
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

export default function EditVideoVoiceDubbingPanel({
  onSaved,
}: {
  onSaved?: () => void;
}) {
  const [modeTab, setModeTab] = React.useState<"audio" | "tts" | "video">("audio");
  const [models, setModels] = React.useState<VoiceModel[]>([]);
  const [modelsBusy, setModelsBusy] = React.useState(false);
  const [modelsError, setModelsError] = React.useState("");
  const [selectedModelId, setSelectedModelId] = React.useState("");

  const [performanceFile, setPerformanceFile] = React.useState<File | null>(
    null,
  );
  const [performanceUrl, setPerformanceUrl] = React.useState("");
  const [recording, setRecording] = React.useState(false);
  const [recordStatus, setRecordStatus] = React.useState("");
  const [engine, setEngine] = React.useState<
    "auto" | "seed-vc" | "xtts"
  >("auto");
  const [pitch, setPitch] = React.useState(0);
  const [outputTitle, setOutputTitle] = React.useState("character_voice_dub");
  const [busy, setBusy] = React.useState(false);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [result, setResult] = React.useState<AudioDubResult | null>(null);

  const [videoFile, setVideoFile] = React.useState<File | null>(null);
  const [videoUrl, setVideoUrl] = React.useState("");
  const [voiceSampleFile, setVoiceSampleFile] = React.useState<File | null>(
    null,
  );
  const [voiceSampleUrl, setVoiceSampleUrl] = React.useState("");
  const [videoTranscript, setVideoTranscript] = React.useState("");
  const [videoTtsEngine, setVideoTtsEngine] = React.useState<VideoTtsEngine>("xtts");
  const [videoDubMode, setVideoDubMode] = React.useState<"replace" | "overlay">(
    "replace",
  );
  const [videoTitle, setVideoTitle] = React.useState("xtts_video_dub");
  const [videoBusy, setVideoBusy] = React.useState(false);
  const [videoSaveBusy, setVideoSaveBusy] = React.useState(false);
  const [videoStatus, setVideoStatus] = React.useState("");
  const [videoResult, setVideoResult] = React.useState<VideoDubResult | null>(
    null,
  );

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);

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
      if (!response.ok || data?.ok === false)
        throw new Error(data?.error || "Voice model scan failed.");
      const items = Array.isArray(data?.items) ? data.items : [];
      setModels(items);
      setSelectedModelId(
        (current) =>
          current ||
          items.find((item: VoiceModel) => item.usable)?.id ||
          items[0]?.id ||
          "",
      );
    } catch (error: any) {
      setModelsError(error?.message || "Voice model scan failed.");
    } finally {
      setModelsBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void loadModels();
    return () => {
      if (performanceUrl.startsWith("blob:"))
        URL.revokeObjectURL(performanceUrl);
      if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
      if (voiceSampleUrl.startsWith("blob:"))
        URL.revokeObjectURL(voiceSampleUrl);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadModels]);

  function setPerformanceAudio(file: File | null) {
    if (!file) return;
    if (
      !file.type.startsWith("audio/") &&
      !/\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(file.name)
    ) {
      setStatus("Select an audio file only.");
      return;
    }
    if (performanceUrl.startsWith("blob:")) URL.revokeObjectURL(performanceUrl);
    setResult(null);
    setStatus("");
    setPerformanceFile(file);
    setPerformanceUrl(URL.createObjectURL(file));
  }

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordStatus(
        "Mic recording is not available in this browser/context.",
      );
      return;
    }
    try {
      setRecordStatus("Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0)
          chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const ext = recorder.mimeType.includes("mp4")
          ? "m4a"
          : recorder.mimeType.includes("wav")
            ? "wav"
            : "webm";
        const file = new File(
          [blob],
          `recorded_performance_${Date.now()}.${ext}`,
          { type: blob.type || "audio/webm" },
        );
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        setRecording(false);
        setRecordStatus("Recording captured. Preview it before converting.");
        setPerformanceAudio(file);
      };
      recorder.start();
      setRecording(true);
      setRecordStatus("Recording. Click Stop Recording when finished.");
    } catch (error: any) {
      setRecordStatus(error?.message || "Microphone access failed.");
      setRecording(false);
    }
  }

  async function convertVoice() {
    if (!performanceFile)
      return setStatus("Record or upload performance audio first.");
    if (!selectedModel)
      return setStatus("Select a character/reference voice first.");
    if (!selectedModel.usable)
      return setStatus(
        selectedModel.notes ||
          "Selected voice is not usable for conversion yet.",
      );
    const form = new FormData();
    form.append("performance_audio", performanceFile, performanceFile.name);
    form.append("voice_id", selectedModel.id);
    form.append("voice_path", selectedModel.path);
    form.append("engine", engine);
    form.append("pitch", String(pitch));
    form.append("title", cleanName(outputTitle));
    setBusy(true);
    setResult(null);
    setStatus(
      "Converting performance audio into the selected character voice...",
    );
    try {
      const response = await fetch("/api/voice/dub", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false)
        throw new Error(data?.error || "Voice dubbing failed.");
      setResult({
        jobId: String(data.jobId || ""),
        fileName: String(data.fileName || "voice_dub.wav"),
        url: String(data.url || ""),
        saved: Boolean(data.saved),
        engine: String(data.engine || selectedModel.engine),
        modelName: String(data.modelName || selectedModel.name),
        message: String(data.message || ""),
      });
      setStatus(data?.message || "Voice dub is ready.");
    } catch (error: any) {
      setStatus(error?.message || "Voice dubbing failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveToGallery() {
    if (!result?.jobId || !result.fileName) return;
    setSaveBusy(true);
    setStatus("Saving dubbed audio to Gallery...");
    try {
      const response = await fetch("/api/voice/dub/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: result.jobId,
          fileName: result.fileName,
          title: cleanName(outputTitle),
          engine: result.engine,
          modelName: result.modelName,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false)
        throw new Error(data?.error || "Save to Gallery failed.");
      setResult((current) => (current ? { ...current, saved: true } : current));
      setStatus("Saved to Gallery.");
      onSaved?.();
    } catch (error: any) {
      setStatus(error?.message || "Save to Gallery failed.");
    } finally {
      setSaveBusy(false);
    }
  }

  function useInProduction() {
    if (!result?.url) return;
    try {
      window.dispatchEvent(
        new CustomEvent("otg:production-reference-audio", {
          detail: {
            url: result.url,
            fileName: result.fileName,
            title: outputTitle,
            source: "voice-dubbing",
          },
        }),
      );
      setStatus(
        "Dubbed audio prepared for Production. Production wiring can consume otg:production-reference-audio when that phase is opened.",
      );
    } catch {
      setStatus(
        "Dubbed audio is ready. Production wiring is not connected yet.",
      );
    }
  }

  function setVideoInput(file: File | null) {
    if (!file) return;
    if (
      !file.type.startsWith("video/") &&
      !/\.(mp4|webm|mov|mkv)$/i.test(file.name)
    )
      return setVideoStatus("Select a video file only.");
    if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setVideoResult(null);
    setVideoStatus("");
  }

  function setVoiceSampleInput(file: File | null) {
    if (!file) return;
    if (
      !file.type.startsWith("audio/") &&
      !/\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(file.name)
    )
      return setVideoStatus("Select an audio file for the voice sample.");
    if (voiceSampleUrl.startsWith("blob:")) URL.revokeObjectURL(voiceSampleUrl);
    setVoiceSampleFile(file);
    setVoiceSampleUrl(URL.createObjectURL(file));
    setVideoResult(null);
  }

  async function runVideoDub() {
    if (!videoFile) return setVideoStatus("Select a video first.");
    if (!voiceSampleFile && !selectedModel)
      return setVideoStatus(
        "Select a character/reference voice or upload a voice sample.",
      );
    const form = new FormData();
    form.append("video", videoFile, videoFile.name);
    if (voiceSampleFile)
      form.append("voice_upload", voiceSampleFile, voiceSampleFile.name);
    if (selectedModel) form.append("voice_path", selectedModel.path);
    form.append("transcript", videoTranscript);
    form.append("tts_engine", videoTtsEngine);
    form.append("mode", videoDubMode);
    form.append("title", cleanName(videoTitle));
    setVideoBusy(true);
    setVideoResult(null);
    const engineLabel = videoTtsEngine === "omnivoice" ? "OmniVoice" : videoTtsEngine === "qwen3" ? "Qwen3-TTS" : "XTTS";
    setVideoStatus(
      videoTranscript.trim()
        ? `Generating ${engineLabel} speech and replacing video audio...`
        : `Extracting audio, transcribing with Whisper, then generating ${engineLabel} speech...`,
    );
    try {
      const response = await fetch("/api/edit-video/dub-voice", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false)
        throw new Error(data?.error || `${engineLabel} video dub failed.`);
      setVideoResult({
        jobId: String(data.jobId || ""),
        fileName: String(data.fileName || `${videoTtsEngine}_video_dub.mp4`),
        url: String(data.url || ""),
        transcript: String(data.transcript || ""),
        mode: String(data.mode || videoDubMode),
        ttsEngine: String(data.ttsEngine || videoTtsEngine),
        message: String(data.message || ""),
      });
      if (!videoTranscript.trim() && data?.transcript)
        setVideoTranscript(String(data.transcript));
      setVideoStatus(data?.message || `${engineLabel} video dub is ready.`);
    } catch (error: any) {
      setVideoStatus(error?.message || `${engineLabel} video dub failed.`);
    } finally {
      setVideoBusy(false);
    }
  }

  async function saveVideoDubToGallery() {
    if (!videoResult?.jobId || !videoResult.fileName) return;
    setVideoSaveBusy(true);
    setVideoStatus("Saving dubbed video to Gallery...");
    try {
      const response = await fetch("/api/edit-video/dub-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: videoResult.jobId,
          fileName: videoResult.fileName,
          title: cleanName(videoTitle),
          ttsEngine: videoResult.ttsEngine || videoTtsEngine,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false)
        throw new Error(data?.error || "Save to Gallery failed.");
      setVideoResult((current) =>
        current ? { ...current, saved: true } : current,
      );
      setVideoStatus("Saved to Gallery.");
      onSaved?.();
    } catch (error: any) {
      setVideoStatus(error?.message || "Save to Gallery failed.");
    } finally {
      setVideoSaveBusy(false);
    }
  }

  const Button = ({
    active,
    children,
    onClick,
  }: {
    active: boolean;
    children: React.ReactNode;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition ${active ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-50" : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"}`}
    >
      {children}
    </button>
  );

  return (
    <section className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_40px_rgba(80,80,180,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-white/55">
            Voice Dubbing
          </p>
          <h2 className="mt-1 text-2xl font-black text-white">
            Local voice dubbing
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/58">
            Use Seed-VC for voice-to-voice performance conversion, IndexTTS2 for emotional character Text-to-Speech, or XTTS / Qwen3-TTS
            with Whisper to dub an existing video with a Characters tab
            reference voice.
          </p>
        </div>
        <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-cyan-100">
          Local
        </span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          active={modeTab === "audio"}
          onClick={() => setModeTab("audio")}
        >
          Seed-VC Performance Conversion
        </Button>
        <Button
          active={modeTab === "tts"}
          onClick={() => setModeTab("tts")}
        >
          Text-to-Speech
        </Button>
        <Button
          active={modeTab === "video"}
          onClick={() => setModeTab("video")}
        >
          TTS Video Dub
        </Button>
      </div>

      <div className="mt-5 rounded-[22px] border border-white/10 bg-black/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-white">
              Select character/reference voice
            </h3>
            <p className="mt-1 text-xs text-white/50">
              Characters tab voices appear first. Clean C:\\AI\\Voices sources
              are fallback options. Junk folders are ignored.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadModels()}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/75 hover:bg-white/10"
          >
            Rescan
          </button>
        </div>
        <select
          value={selectedModelId}
          onChange={(event) => setSelectedModelId(event.target.value)}
          className="mt-3 w-full rounded-[18px] border border-white/10 bg-black/65 px-4 py-3 text-sm text-white outline-none"
        >
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} [{item.engine.toUpperCase()}]
            </option>
          ))}
        </select>
        {modelsBusy ? (
          <p className="mt-2 text-xs text-white/45">Scanning voices...</p>
        ) : null}
        {modelsError ? (
          <p className="mt-2 text-xs text-red-200/85">{modelsError}</p>
        ) : null}
        {selectedModel ? (
          <div className="mt-3 rounded-[18px] border border-white/10 bg-black/35 p-3 text-xs text-white/60">
            <p className="font-semibold text-white/80">{selectedModel.name}</p>
            <p className="mt-1 break-words">{selectedModel.displayPath}</p>
            {selectedModel.notes ? (
              <p className="mt-2 text-amber-100/75">{selectedModel.notes}</p>
            ) : null}
            {selectedModel.samplePath ? (
              <p className="mt-2 break-words">
                Reference sample: {selectedModel.samplePath}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {modeTab === "audio" ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
            <h3 className="text-sm font-black text-white">
              Step 1: Record or upload performance audio
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void toggleRecording()}
                className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-5 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-400/15"
              >
                {recording ? "Stop Recording" : "Record Voice"}
              </button>
              <label className="inline-flex cursor-pointer rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-white hover:bg-white/10">
                Upload Audio
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
                  className="hidden"
                  onChange={(event) =>
                    setPerformanceAudio(event.target.files?.[0] || null)
                  }
                />
              </label>
            </div>
            {recordStatus ? (
              <p className="mt-2 text-xs text-white/50">{recordStatus}</p>
            ) : null}
            {performanceUrl ? (
              <audio
                src={performanceUrl}
                controls
                preload="metadata"
                className="mt-3 w-full"
              />
            ) : (
              <div className="mt-3 rounded-[18px] border border-white/10 bg-black/35 px-4 py-4 text-sm text-white/45">
                No performance audio selected.
              </div>
            )}
          </div>
          <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
            <h3 className="text-sm font-black text-white">
              Step 2: Convert voice
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_180px_2fr]">
              <div>
                <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                  Engine
                </label>
                <select
                  value={engine}
                  onChange={(event) => setEngine(event.target.value as any)}
                  className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="auto">Auto (Seed-VC preferred)</option>
                  <option value="seed-vc">Seed-VC</option>
                  <option value="xtts">XTTS fallback</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                  Pitch shift
                </label>
                <input
                  type="number"
                  min="-24"
                  max="24"
                  value={pitch}
                  onChange={(event) => setPitch(Number(event.target.value))}
                  className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                  Output name
                </label>
                <input
                  value={outputTitle}
                  onChange={(event) =>
                    setOutputTitle(cleanName(event.target.value))
                  }
                  className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => void convertVoice()}
              disabled={busy || !performanceFile || !selectedModelId}
              className="mt-4 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-5 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Converting..." : "Convert Voice"}
            </button>
          </div>
          {status ? (
            <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">
              {status}
            </div>
          ) : null}
          {result?.url ? (
            <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
              <h4 className="text-sm font-black text-white">Preview output</h4>
              <audio
                src={result.url}
                controls
                preload="metadata"
                className="mt-3 w-full"
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={withDownload(result.url)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => void saveToGallery()}
                  disabled={saveBusy || result.saved}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                >
                  {result.saved
                    ? "Saved to Gallery"
                    : saveBusy
                      ? "Saving..."
                      : "Save to Gallery"}
                </button>
                <button
                  type="button"
                  onClick={useInProduction}
                  className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-400/15"
                >
                  Use in Production
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {modeTab === "tts" ? (
        <CharacterTextToSpeechPanel onSaved={onSaved} />
      ) : null}

      {modeTab === "video" ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-[22px] border border-cyan-400/15 bg-cyan-400/[0.04] p-4">
            <h3 className="text-sm font-black text-white">
              XTTS / Qwen3-TTS / OmniVoice + Whisper video dubbing
            </h3>
            <p className="mt-2 text-sm leading-6 text-white/60">
              V1 is simple whole-clip dubbing: extract video audio, use
              transcript text or local Whisper, generate cloned speech with
              the selected local TTS engine, then replace or lightly overlay
              the original audio with FFmpeg. Qwen3-TTS requires a configured
              local command or service. OmniVoice requires its own install command/service. No lip-sync or sentence timing yet.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
              <h4 className="text-sm font-black text-white">
                Step 1: Select video
              </h4>
              <label className="mt-3 inline-flex cursor-pointer rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-white hover:bg-white/10">
                Upload Video
                <input
                  type="file"
                  accept="video/*,.mp4,.webm,.mov,.mkv"
                  className="hidden"
                  onChange={(event) =>
                    setVideoInput(event.target.files?.[0] || null)
                  }
                />
              </label>
              {videoUrl ? (
                <video
                  src={videoUrl}
                  controls
                  preload="metadata"
                  className="mt-3 max-h-[360px] w-full rounded-[18px] border border-white/10 bg-black object-contain"
                />
              ) : (
                <div className="mt-3 rounded-[18px] border border-white/10 bg-black/35 px-4 py-6 text-sm text-white/45">
                  No video selected.
                </div>
              )}
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
              <h4 className="text-sm font-black text-white">
                Step 2: Voice source
              </h4>
              <p className="mt-2 text-xs text-white/50">
                Default uses the selected Characters tab/reference voice above.
                Uploading a sample overrides it for this job.
              </p>
              <label className="mt-3 inline-flex cursor-pointer rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-white hover:bg-white/10">
                Upload Voice Sample
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
                  className="hidden"
                  onChange={(event) =>
                    setVoiceSampleInput(event.target.files?.[0] || null)
                  }
                />
              </label>
              {voiceSampleUrl ? (
                <audio
                  src={voiceSampleUrl}
                  controls
                  preload="metadata"
                  className="mt-3 w-full"
                />
              ) : (
                <div className="mt-3 rounded-[18px] border border-white/10 bg-black/35 px-4 py-4 text-sm text-white/45">
                  Using selected character/reference voice.
                </div>
              )}
            </div>
          </div>
          <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
            <h4 className="text-sm font-black text-white">
              Step 3: Transcript and output
            </h4>
            <label className="mt-3 block text-xs font-black uppercase tracking-[0.18em] text-white/45">
              Transcript
            </label>
            <textarea
              value={videoTranscript}
              onChange={(event) => setVideoTranscript(event.target.value)}
              placeholder="Optional for v1. Type the words here for fastest TTS dubbing. Leave blank only if WHISPER_DUB_COMMAND / FASTER_WHISPER_COMMAND is configured."
              className="mt-2 min-h-32 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"
            />
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
              <div>
                <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                  TTS engine
                </label>
                <select
                  value={videoTtsEngine}
                  onChange={(event) =>
                    setVideoTtsEngine(event.target.value as VideoTtsEngine)
                  }
                  className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="xtts">XTTS v2</option>
                  <option value="qwen3">Qwen3-TTS</option>
                  <option value="omnivoice">OmniVoice</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                  Audio mode
                </label>
                <select
                  value={videoDubMode}
                  onChange={(event) =>
                    setVideoDubMode(event.target.value as any)
                  }
                  className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="replace">Replace original audio</option>
                  <option value="overlay">
                    Keep low original + overlay cloned voice
                  </option>
                </select>
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                  Output name
                </label>
                <input
                  value={videoTitle}
                  onChange={(event) =>
                    setVideoTitle(cleanName(event.target.value))
                  }
                  className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => void runVideoDub()}
              disabled={
                videoBusy ||
                !videoFile ||
                (!voiceSampleFile && !selectedModelId)
              }
              className="mt-4 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-5 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {videoBusy
                ? "Generating Dub..."
                : videoTtsEngine === "omnivoice"
                  ? "Generate OmniVoice Video Dub"
                : videoTtsEngine === "qwen3"
                  ? "Generate Qwen3 Video Dub"
                  : "Generate XTTS Video Dub"}
            </button>
          </div>
          {videoStatus ? (
            <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">
              {videoStatus}
            </div>
          ) : null}
          {videoResult?.url ? (
            <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
              <h4 className="text-sm font-black text-white">
                Step 4: Preview dubbed video
              </h4>
              <video
                src={videoResult.url}
                controls
                preload="metadata"
                className="mt-3 max-h-[520px] w-full rounded-[18px] border border-white/10 bg-black object-contain"
              />
              {videoResult.transcript ? (
                <details className="mt-3 text-sm text-white/60">
                  <summary className="cursor-pointer font-semibold text-white/75">
                    Transcript used
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap rounded-[14px] bg-black/40 p-3">
                    {videoResult.transcript}
                  </p>
                </details>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={withDownload(videoResult.url)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => void saveVideoDubToGallery()}
                  disabled={videoSaveBusy || videoResult.saved}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                >
                  {videoResult.saved
                    ? "Saved to Gallery"
                    : videoSaveBusy
                      ? "Saving..."
                      : "Save to Gallery"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
