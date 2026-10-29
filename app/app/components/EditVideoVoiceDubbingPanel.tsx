"use client";

import React from "react";

type WorkflowMode = "convert" | "rewrite";

type VoiceModel = {
  id: string;
  name: string;
  engine: "reference" | "character" | "seed-vc" | "xtts";
  path: string;
  displayPath: string;
  modelPath?: string;
  indexPath?: string;
  samplePath?: string;
  usable: boolean;
  notes?: string;
};

type SpeechSegment = {
  start: number;
  end: number;
  speakerId?: string;
  text?: string;
};

type DetectedVoiceLane = {
  id: string;
  label: string;
  description?: string;
  segments: SpeechSegment[];
  segmentCount: number;
  totalSpeechSeconds: number;
  confidence?: string;
};

type ClipAnalysis = {
  ok: boolean;
  runId: string;
  sourcePath: string;
  sourceFileName: string;
  durationSeconds: number;
  separation?: { tool?: string; backgroundStemAvailable?: boolean };
  diarization?: { tool?: string; note?: string };
  voices: DetectedVoiceLane[];
};

type LaneMapping = { targetVoiceId: string; replacementText: string };

type DubResult = {
  previewVideoUrl?: string;
  previewVideoPath?: string;
  workflow?: Record<string, unknown>;
  mixPlan?: Record<string, unknown>;
};

function safeTitle(value: string) {
  return (
    String(value || "voice_conversion")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-zA-Z0-9._ -]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "voice_conversion"
  );
}

function downloadUrl(url: string) {
  return url ? `${url}${url.includes("?") ? "&" : "?"}download=1` : "#";
}

function methodLabel(model: VoiceModel | undefined) {
  if (!model) return "Choose a target voice";
  return model.engine === "character" ? "Trained Applio voice" : "Seed-VC reference voice";
}

function PillButton({
  active,
  children,
  disabled,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 items-center justify-center rounded-full border px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
        active
          ? "border-cyan-300/45 bg-cyan-300/15 text-cyan-50"
          : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

export default function EditVideoVoiceDubbingPanel({
  onSaved,
  initialSource,
}: {
  onSaved?: () => void;
  initialSource?: {path:string;name:string;url:string};
}) {
  void onSaved;
  const [mode, setMode] = React.useState<WorkflowMode>("convert");
  const [models, setModels] = React.useState<VoiceModel[]>([]);
  const [modelsBusy, setModelsBusy] = React.useState(false);
  const [modelsError, setModelsError] = React.useState("");
  const [videoFile, setVideoFile] = React.useState<File | null>(null);
  const [videoUrl, setVideoUrl] = React.useState(initialSource?.url||"");
  const [serverSource,setServerSource] = React.useState(initialSource);
  const [analysis, setAnalysis] = React.useState<ClipAnalysis | null>(null);
  const [analysisBusy, setAnalysisBusy] = React.useState(false);
  const [expectedSpeakerCount, setExpectedSpeakerCount] = React.useState("auto");
  const [mappings, setMappings] = React.useState<Record<string, LaneMapping>>({});
  const [title, setTitle] = React.useState("voice_converted_video");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState(initialSource?"Current Audio Editing video is ready. Click Analyze Speech.":"");
  const [error, setError] = React.useState("");
  const [result, setResult] = React.useState<DubResult | null>(null);
  const [quickVoiceName, setQuickVoiceName] = React.useState("");
  const [quickVoiceFile, setQuickVoiceFile] = React.useState<File | null>(null);
  const [quickVoiceBusy, setQuickVoiceBusy] = React.useState(false);
  const videoUrlRef = React.useRef("");

  const loadModels = React.useCallback(async (preferredId = "") => {
    setModelsBusy(true);
    setModelsError("");
    try {
      const response = await fetch("/api/voice/models", { cache: "no-store", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Voice library could not be loaded.");
      const items = Array.isArray(data?.items) ? (data.items as VoiceModel[]) : [];
      setModels(items);
      if (preferredId) {
        setMappings((current) => {
          const next = { ...current };
          for (const lane of analysis?.voices || []) {
            if (!next[lane.id]?.targetVoiceId) next[lane.id] = { ...(next[lane.id] || { replacementText: "" }), targetVoiceId: preferredId };
          }
          return next;
        });
      }
      return items;
    } catch (loadError: any) {
      setModelsError(loadError?.message || "Voice library could not be loaded.");
      return [] as VoiceModel[];
    } finally {
      setModelsBusy(false);
    }
  }, [analysis]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadModels();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (videoUrlRef.current.startsWith("blob:")) URL.revokeObjectURL(videoUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setVideo(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|mkv)$/i.test(file.name)) {
      setError("Choose an MP4, WEBM, MOV, or MKV video.");
      return;
    }
    if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setServerSource(undefined);
    const nextUrl = URL.createObjectURL(file);
    videoUrlRef.current = nextUrl;
    setVideoUrl(nextUrl);
    setAnalysis(null);
    setMappings({});
    setResult(null);
    setError("");
    setStatus("Video ready. Click Analyze Speech.");
  }

  async function analyzeSpeech() {
    if (!videoFile&&!serverSource) {
      setError("Upload a video first.");
      return;
    }
    setAnalysisBusy(true);
    setError("");
    setResult(null);
    setStatus("Analyzing speech, separating dialogue, and detecting speakers...");
    try {
      const form = new FormData();
      if(videoFile)form.append("video", videoFile, videoFile.name);
      if (expectedSpeakerCount !== "auto") form.append("expectedSpeakerCount", expectedSpeakerCount);
      const response = await fetch("/api/production/audio/analyze-clip", { method: "POST",
        ...(videoFile?{body:form}:{headers:{"Content-Type":"application/json"},body:JSON.stringify({sourcePath:serverSource!.path,sourceFileName:serverSource!.name,...(expectedSpeakerCount!=="auto"?{expectedSpeakerCount}:{})})}),
        credentials: "include", cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as ClipAnalysis & { error?: string };
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Speech analysis failed.");
      const lanes = Array.isArray(data.voices) ? data.voices : [];
      setAnalysis(data);
      setMappings(Object.fromEntries(lanes.map((lane) => [lane.id, { targetVoiceId: "", replacementText: "" }])));
      setStatus(lanes.length ? `Found ${lanes.length} voice lane${lanes.length === 1 ? "" : "s"}. Assign a target voice to continue.` : "No clear speech lanes were detected.");
    } catch (analysisError: any) {
      setAnalysis(null);
      setMappings({});
      setError(analysisError?.message || "Speech analysis failed.");
      setStatus("");
    } finally {
      setAnalysisBusy(false);
    }
  }

  function updateMapping(laneId: string, patch: Partial<LaneMapping>) {
    setMappings((current) => ({ ...current, [laneId]: { ...(current[laneId] || { targetVoiceId: "", replacementText: "" }), ...patch } }));
  }

  function updateSegment(laneId: string, index: number, key: "start" | "end", value: number) {
    setAnalysis((current) => {
      if (!current) return current;
      return {
        ...current,
        voices: current.voices.map((lane) => {
          if (lane.id !== laneId) return lane;
          const segments = lane.segments.map((segment, segmentIndex) => {
            if (segmentIndex !== index) return segment;
            const next = { ...segment, [key]: Math.max(0, value) };
            if (next.end <= next.start) {
              if (key === "start") next.end = next.start + 0.05;
              else next.start = Math.max(0, next.end - 0.05);
            }
            return next;
          });
          return { ...lane, segments };
        }),
      };
    });
  }

  async function addQuickReferenceVoice() {
    if (!quickVoiceFile) {
      setError("Choose a clean 5–10 second voice sample first.");
      return;
    }
    setQuickVoiceBusy(true);
    setError("");
    setStatus("Adding the reference sample to the voice library...");
    try {
      const form = new FormData();
      form.append("file", quickVoiceFile, quickVoiceFile.name);
      form.append("name", quickVoiceName.trim() || quickVoiceFile.name.replace(/\.[^.]+$/, ""));
      const response = await fetch("/api/voice/reference", { method: "POST", body: form, credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Reference voice could not be added.");
      await loadModels(`library:${String(data.voice?.voiceId || "")}`);
      setQuickVoiceFile(null);
      setQuickVoiceName("");
      setStatus("Reference voice added. It is available as a Seed-VC target below.");
    } catch (voiceError: any) {
      setError(voiceError?.message || "Reference voice could not be added.");
      setStatus("");
    } finally {
      setQuickVoiceBusy(false);
    }
  }

  function openVoiceTraining() {
    window.location.href = "/app?tab=characters";
  }

  async function runVoiceWorkflow() {
    if (!analysis?.sourcePath || !analysis.voices.length) {
      setError("Analyze the video before starting the voice workflow.");
      return;
    }
    const mappingsToSend = [];
    for (const lane of analysis.voices) {
      const laneMapping = mappings[lane.id];
      const target = models.find((model) => model.id === laneMapping?.targetVoiceId);
      if (!target) {
        setError(`Choose a target voice for ${lane.label}.`);
        return;
      }
      if (mode === "rewrite" && !laneMapping?.replacementText.trim()) {
        setError(`Enter replacement dialogue for ${lane.label}.`);
        return;
      }
      if (target.engine === "character" && (!target.modelPath || !target.indexPath)) {
        setError(`${target.name} is missing its trained Applio model or index.`);
        return;
      }
      mappingsToSend.push({
        voiceId: lane.id,
        voiceName: target.name,
        voiceModelId: target.id,
        characterId: target.engine === "character" ? target.id.replace(/^character:/, "").split(":")[0] : "",
        voicePath: target.path,
        modelPath: target.modelPath || "",
        indexPath: target.indexPath || "",
        samplePath: target.samplePath || (target.engine === "reference" ? target.path : ""),
        engine: target.engine === "character" ? "applio" : "auto",
        dubMode: mode === "rewrite" ? "rewrite_line" : "preserve_performance",
        emotion: "preserve",
        replacementText: laneMapping?.replacementText || "",
        segments: lane.segments,
      });
    }

    setBusy(true);
    setError("");
    setResult(null);
    setStatus(mode === "rewrite" ? "Generating replacement dialogue and rebuilding the video audio..." : "Converting each detected dialogue lane and rebuilding the video audio...");
    try {
      const response = await fetch("/api/production/audio/dub-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          sourcePath: analysis.sourcePath,
          sourceFileName: analysis.sourceFileName || videoFile?.name || serverSource?.name || "source-video.mp4",
          title: safeTitle(title),
          voiceMappings: mappingsToSend,
          audioClipAnalysis: analysis,
          dubMode: mode === "rewrite" ? "rewrite_line" : "preserve_performance",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Voice workflow failed.");
      setResult(data as DubResult);
      setStatus(mode === "rewrite" ? "Replacement dialogue video is ready for review." : "Voice-converted video is ready for review.");
    } catch (workflowError: any) {
      setError(workflowError?.message || "Voice workflow failed.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const usableModels = models.filter((model) => model.usable);

  return (
    <section className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_40px_rgba(80,80,180,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200/70">Video Voice Studio</p>
          <h2 className="mt-1 text-2xl font-black text-white">Change voices without rebuilding the video by hand</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/60">Upload the finished video once. The app analyzes the dialogue, assigns voices, converts the selected lanes, and restores the original video, music, and effects automatically.</p>
        </div>
        <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-cyan-100">Local</span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <PillButton active={mode === "convert"} onClick={() => setMode("convert")}>Preserve Performance</PillButton>
        <PillButton active={mode === "rewrite"} onClick={() => setMode("rewrite")}>Rewrite Dialogue</PillButton>
      </div>

      <div className="mt-4 rounded-[18px] border border-cyan-300/15 bg-cyan-300/[0.05] p-4 text-sm leading-6 text-cyan-50/80">
        {mode === "convert" ? <><strong className="text-cyan-50">Preserve Performance:</strong> the original words, timing, pauses, and delivery stay in place. A 5–10 second reference sample uses Seed-VC; a trained character voice uses Applio.</> : <><strong className="text-cyan-50">Rewrite Dialogue:</strong> enter new words for each detected speaker. AuK generates the new source line, then the selected voice converts it into the target character. This is separate from performance-preserving conversion.</>}
      </div>

      <div className="mt-5 rounded-[22px] border border-white/10 bg-black/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="text-sm font-black text-white">1. Upload the source video</h3><p className="mt-1 text-xs text-white/50">No audio extraction or reattachment is required from the user.</p></div>
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">{videoFile||serverSource ? "Choose a different video" : "Upload Video"}<input type="file" accept="video/*,.mp4,.webm,.mov,.mkv" className="hidden" onChange={(event) => setVideo(event.target.files?.[0] || null)} /></label>
        </div>
        {videoUrl ? <video src={videoUrl} controls preload="metadata" className="mt-4 max-h-[420px] w-full rounded-[18px] border border-white/10 bg-black object-contain" /> : <div className="mt-4 rounded-[18px] border border-dashed border-white/10 bg-black/25 px-4 py-10 text-center text-sm text-white/40">Choose the H3 video you want to edit.</div>}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Speaker count<select value={expectedSpeakerCount} onChange={(event) => setExpectedSpeakerCount(event.target.value)} className="mt-2 block min-h-11 rounded-[14px] border border-white/10 bg-black/45 px-3 text-sm font-semibold normal-case tracking-normal text-white outline-none"><option value="auto">Auto detect</option><option value="1">1 speaker</option><option value="2">2 speakers</option><option value="3">3 speakers</option><option value="4">4 speakers</option><option value="5">5 speakers</option></select></label>
          <PillButton disabled={analysisBusy || (!videoFile&&!serverSource)} onClick={() => void analyzeSpeech()}>{analysisBusy ? "Analyzing..." : "Analyze Speech"}</PillButton>
        </div>
      </div>

      <div className="mt-5 rounded-[22px] border border-white/10 bg-black/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-black text-white">2. Add a quick reference voice or train a permanent one</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-white/50">A clean 5–10 second sample is enough for Seed-VC. Use Train a Voice when you want a repeatable Applio character model.</p></div><PillButton onClick={openVoiceTraining}>Train a Voice</PillButton></div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]"><input value={quickVoiceName} onChange={(event) => setQuickVoiceName(event.target.value)} placeholder="Reference name, e.g. Test Voice 1" className="min-h-11 rounded-[14px] border border-white/10 bg-black/45 px-3 text-sm text-white outline-none placeholder:text-white/30" /><label className="flex min-h-11 cursor-pointer items-center rounded-[14px] border border-white/10 bg-black/45 px-3 text-sm text-white/75">{quickVoiceFile?.name || "Choose 5–10 second sample"}<input type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.webm" className="hidden" onChange={(event) => setQuickVoiceFile(event.target.files?.[0] || null)} /></label><PillButton disabled={quickVoiceBusy || !quickVoiceFile} onClick={() => void addQuickReferenceVoice()}>{quickVoiceBusy ? "Adding..." : "Add Voice"}</PillButton></div>
        {modelsBusy ? <p className="mt-3 text-xs text-white/45">Loading voice library...</p> : null}
        {modelsError ? <p className="mt-3 text-xs text-rose-200">{modelsError}</p> : null}
        {!modelsBusy && !usableModels.length ? <p className="mt-3 rounded-[14px] border border-amber-300/20 bg-amber-300/[0.06] px-3 py-3 text-sm text-amber-100/80">No target voices are visible for this session yet. Add a quick reference sample or sign into the profile that owns the voice library.</p> : null}
      </div>

      {analysis ? <div className="mt-5 rounded-[22px] border border-white/10 bg-black/30 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-black text-white">3. Assign target voices</h3><p className="mt-1 text-xs text-white/50">Each detected lane can use a different target voice. Adjust the time boundaries only when automatic detection needs correction.</p></div><div className="text-right text-xs text-white/45"><div>{analysis.durationSeconds.toFixed(2)} seconds</div><div>{analysis.diarization?.tool || "speech analysis"}</div></div></div>
        <div className="mt-4 space-y-4">{analysis.voices.map((lane, laneIndex) => { const laneMapping = mappings[lane.id] || { targetVoiceId: "", replacementText: "" }; const target = models.find((model) => model.id === laneMapping.targetVoiceId); return <div key={lane.id} className="rounded-[18px] border border-white/10 bg-black/25 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-black text-white">{lane.label || `Voice ${laneIndex + 1}`}</h4><p className="mt-1 text-xs text-white/50">{lane.segmentCount} dialogue section{lane.segmentCount === 1 ? "" : "s"} · {lane.totalSpeechSeconds.toFixed(2)} seconds</p></div><span className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-bold text-white/50">{lane.confidence || "detected"}</span></div><select aria-label={`Target voice for ${lane.label || `Voice ${laneIndex + 1}`}`} value={laneMapping.targetVoiceId} onChange={(event) => updateMapping(lane.id, { targetVoiceId: event.target.value })} className="mt-3 min-h-11 w-full rounded-[14px] border border-white/10 bg-black/50 px-3 text-sm font-semibold text-white outline-none"><option value="">Choose target voice</option>{usableModels.map((model) => <option key={model.id} value={model.id}>{model.name} — {methodLabel(model)}</option>)}</select>{target ? <p className="mt-2 text-xs text-cyan-100/65">{methodLabel(target)}. {target.engine === "character" ? "Uses the trained model." : "Uses the saved reference sample; no training required."}</p> : null}{mode === "rewrite" ? <textarea value={laneMapping.replacementText} onChange={(event) => updateMapping(lane.id, { replacementText: event.target.value })} rows={2} placeholder={`New dialogue for ${lane.label || "this speaker"}`} className="mt-3 w-full rounded-[14px] border border-white/10 bg-black/45 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30" /> : null}<div className="mt-3 grid gap-2 md:grid-cols-2">{lane.segments.map((segment, segmentIndex) => <div key={`${lane.id}-${segmentIndex}`} className="rounded-[12px] border border-white/10 bg-black/25 p-3"><div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-white/40">Section {segmentIndex + 1}{segment.text ? ` · ${segment.text}` : ""}</div><div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-white/45">Start<input type="number" min="0" step="0.05" value={segment.start} onChange={(event) => updateSegment(lane.id, segmentIndex, "start", Number(event.target.value))} className="mt-1 min-h-9 w-full rounded-[10px] border border-white/10 bg-black/45 px-2 text-sm text-white outline-none" /></label><label className="text-[11px] text-white/45">End<input type="number" min="0" step="0.05" value={segment.end} onChange={(event) => updateSegment(lane.id, segmentIndex, "end", Number(event.target.value))} className="mt-1 min-h-9 w-full rounded-[10px] border border-white/10 bg-black/45 px-2 text-sm text-white outline-none" /></label></div></div>)}</div></div>; })}</div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end"><label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Output name<input value={title} onChange={(event) => setTitle(safeTitle(event.target.value))} className="mt-2 min-h-11 w-full rounded-[14px] border border-white/10 bg-black/45 px-3 text-sm font-semibold normal-case tracking-normal text-white outline-none" /></label><PillButton active disabled={busy || !analysis.voices.length} onClick={() => void runVoiceWorkflow()}>{busy ? "Working..." : mode === "rewrite" ? "Rewrite Dialogue" : "Convert Voices"}</PillButton></div><p className="mt-3 text-xs leading-5 text-white/45">Music and sound effects are kept through the dialogue/background mix. The original video stream is preserved.</p>
      </div> : null}

      {status ? <div className="mt-4 rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/75">{status}</div> : null}
      {error ? <div role="alert" className="mt-4 rounded-[16px] border border-rose-300/25 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100">{error}</div> : null}
      {result?.previewVideoUrl ? <div className="mt-5 rounded-[22px] border border-emerald-300/20 bg-emerald-300/[0.05] p-4"><h3 className="text-sm font-black text-white">4. Preview the result</h3><video src={result.previewVideoUrl} controls preload="metadata" className="mt-3 max-h-[520px] w-full rounded-[18px] border border-white/10 bg-black object-contain" /><div className="mt-4 flex flex-wrap gap-2"><a href={downloadUrl(result.previewVideoUrl)} className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">Download Video</a><button type="button" onClick={() => { setResult(null); setStatus("Ready for another conversion."); }} className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">Start Another</button></div><p className="mt-3 text-xs leading-5 text-emerald-100/65">Review target voice identity, timing, emotion, loudness, music, and effects before processing more clips.</p></div> : null}
    </section>
  );
}
