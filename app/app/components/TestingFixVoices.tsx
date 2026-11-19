"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_VOICE_LEVEL_DB, MIN_VOICE_LEVEL_DB } from "@/lib/fixVoicesDsp";
import { MAX_SCENE_FINE_TUNE, type SceneFineTune } from "@/lib/fixVoicesSceneMatch";
import { testingVoiceRequest } from "@/lib/client/voiceRequest";

const analyzeEndpoint = "/api/production/audio/analyze-clip";
const dubEndpoint = "/api/production/audio/dub-preview";
const field = "min-h-10 w-full min-w-0 rounded-lg border border-white/20 bg-slate-950 p-2 text-sm";
const button = "min-h-10 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40";

type Segment = { start: number; end: number; text?: string; blockedReason?: string };
type Lane = { id: string; label: string; sampleUrl?: string; segments: Segment[]; suggestedTargetVoiceId?: string; suggestedTargetVoiceName?: string; suggestedCharacterId?: string; needsCharacterConfirmation?: boolean };
type CastVoice = { characterId: string; name: string; voiceId?: string; voiceName?: string };
type Analysis = { cast?: CastVoice[]; analysisId: string; sourceVideoUrl: string; sourceFileName: string; durationSeconds: number; voices: Lane[]; mixReady: boolean; warnings?: string[]; restoredPreview?: Result };
type Result = { previewId?: string; previewVideoUrl?: string; unadjustedVideoUrl?: string; warnings?: string[]; matchOriginalScene?: boolean;
  renderedSegments?: Array<Segment & {voiceId: string; levelDb?: number; cueIndex?: number; fineTune?: SceneFineTune; fineTuneWarning?: string}>;
  skippedSegments?: Array<Segment & { reason?: string }> };
type CompareVersion = "original" | "unadjusted" | "converted";
const automaticTune: SceneFineTune = {distance: 0, reflections: 0};
type Voice = { id: string; name: string; usable: boolean };
type GalleryClip = { name: string; fileName: string; source: string; url: string };
type Take = { voiceId: string; segmentIndex: number; file: File };
export type FixVoicesHandoff = { jobId: string } | { galleryName: string; galleryScope: string } | {nsfwAssetId:string} | {nsfwSavedId:string};

function timestamp(time: number) {
  return Number.isFinite(time) ? `${time.toFixed(2)}s` : "";
}

function TakeInput({ value, onChange, disabled }: { value?: File; onChange: (file?: File) => void; disabled: boolean }) {
  const [recording, setRecording] = useState(false);
  const [permission, setPermission] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const capture = useRef<MediaRecorder | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const token = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!value) { setUrl(""); return; }
    const preview = URL.createObjectURL(value);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [value]);

  useEffect(() => () => {
    token.current += 1;
    window.clearTimeout(timer.current);
    if (capture.current?.state === "recording") capture.current.stop();
    mic.current?.getTracks().forEach(track => track.stop());
  }, []);

  async function start() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone capture is unavailable here. Choose an audio file instead.");
      return;
    }
    const run = ++token.current;
    setPermission(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token.current !== run) { stream.getTracks().forEach(track => track.stop()); return; }
      mic.current = stream;
      const preferred = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      capture.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        window.clearTimeout(timer.current);
        stream.getTracks().forEach(track => track.stop());
        capture.current = null;
        mic.current = null;
        if (run !== token.current) return;
        setRecording(false);
        const mime = recorder.mimeType || chunks[0]?.type || "audio/webm";
        const extension = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
        if (chunks.length) onChange(new File(chunks, `performance.${extension}`, { type: mime }));
        else setError("The recording was empty.");
      };
      recorder.onerror = () => {
        if (token.current !== run) return;
        token.current += 1;
        window.clearTimeout(timer.current);
        stream.getTracks().forEach(track => track.stop());
        capture.current = null;
        mic.current = null;
        setRecording(false);
        setError("The microphone stopped before the take finished.");
      };
      recorder.start();
      setRecording(true);
      timer.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 20_000);
    } catch {
      if (token.current === run) {
        mic.current?.getTracks().forEach(track => track.stop());
        mic.current = null;
        setError("Could not use the microphone. You can upload a take.");
      }
    } finally {
      if (token.current === run) setPermission(false);
    }
  }

  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={disabled || permission} onClick={() => {
        if (recording) capture.current?.stop();
        else void start();
      }}>{recording ? "Stop recording" : permission ? "Opening microphone…" : value ? "Record again" : "Record"}</button>
      <label className="min-w-0 text-sm">Upload a take<input className={field} disabled={disabled || permission || recording} type="file" accept="audio/*,.wav,.m4a" onChange={event => {
        const file = event.target.files?.[0];
        if (file) onChange(file);
        event.currentTarget.value = "";
      }} /></label>
      {value && !recording && <button type="button" className={button} disabled={disabled} onClick={() => onChange()}>Remove take</button>}
    </div>
    {url && <audio controls preload="metadata" aria-label="Acted take" src={url} className="w-full" />}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
  </div>;
}

export default function TestingFixVoices({ handoff }: { handoff?: FixVoicesHandoff }) {
  const compact = !!handoff;
  const [analysis, setAnalysis] = useState<Analysis>();
  const [result, setResult] = useState<Result>();
  const [pendingLevels, setPendingLevels] = useState<Record<string, number>>({});
  const [pendingMatch, setPendingMatch] = useState<boolean>();
  const [pendingFineTune, setPendingFineTune] = useState<Record<number, SceneFineTune>>({});
  const [fineTuneCue, setFineTuneCue] = useState(0);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [gallery, setGallery] = useState<GalleryClip[]>();
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const [take, setTake] = useState<Take>();
  const [takeSelection, setTakeSelection] = useState({ voiceId: "", segmentIndex: 0 });
  const [sampleLane, setSampleLane] = useState("");
  const [compare, setCompare] = useState<CompareVersion>("original");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const video = useRef<HTMLVideoElement | null>(null);
  const audition = useRef<HTMLAudioElement | null>(null);
  const comparePoint = useRef<{ time: number; playing: boolean; volume?: number; muted?: boolean } | null>(null);
  const operation = useRef(0);

  async function loadVoices(signal?: AbortSignal) {
    const list = await testingVoiceRequest<{ items: Voice[] }>("/api/voice/models", undefined, signal);
    const items = (list.items || []).filter(item => item.usable);
    if (!signal?.aborted) setVoices(items);
    return items;
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadVoices(controller.signal).catch(reason => {
      if (!controller.signal.aborted) setError(reason.message);
    });
    return () => { controller.abort(); operation.current += 1; audition.current?.pause(); };
  }, []);

  async function act(label: string, action: (current: () => boolean) => Promise<void>) {
    const run = ++operation.current;
    const current = () => run === operation.current;
    setBusy(label);
    setError("");
    setMessage("");
    try { await action(current); }
    catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : "Request failed."); }
    finally { if (current()) setBusy(""); }
  }

  async function analyze(input: object | FormData, signal?: AbortSignal) {
    await act("Analyzing speech…", async current => {
      setAnalysis(undefined);
      setResult(undefined);
      setSavedUrl("");
      setGallery(undefined);
      setTake(undefined);
      setTakeSelection({ voiceId: "", segmentIndex: 0 });
      setSampleLane("");
      setCompare("original");
      comparePoint.current = null;
      setMapping({});
      setConfirmed({});
      setPendingLevels({});
      setPendingMatch(undefined);
      setPendingFineTune({});
      setFineTuneCue(0);
      const fresh = await testingVoiceRequest<Analysis>(analyzeEndpoint, input, signal);
      if (!current()) return;
      setAnalysis(fresh);
      if (fresh.restoredPreview) {
        setResult(fresh.restoredPreview);
        setCompare("converted");
      }
    });
  }

  useEffect(() => {
    if (!handoff) return;
    const controller = new AbortController();
    void analyze({ fixVoices: true, ...("jobId" in handoff
      ? { sourceJobId: handoff.jobId }
      : "nsfwAssetId" in handoff ? {nsfwAssetId:handoff.nsfwAssetId} : "nsfwSavedId" in handoff ? {nsfwSavedId:handoff.nsfwSavedId} : { sourceFileName: handoff.galleryName, sourceScope: handoff.galleryScope }) }, controller.signal);
    return () => controller.abort();
    // The handoff changes only when the user opens a result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  async function selectGallery() {
    if (gallery) { setGallery(undefined); return; }
    await act("Loading Gallery…", async current => {
      const data = await testingVoiceRequest<{ items: GalleryClip[] }>("/api/gallery?media=video&sort=newest&per=40");
      if (current()) setGallery(data.items || []);
    });
  }

  async function registerVoice(file: File, lane: string) {
    await act("Adding voice sample…", async current => {
      const body = new FormData();
      body.set("file", file);
      body.set("name", file.name.replace(/\.[^.]+$/, ""));
      const registered = await testingVoiceRequest<{ voice: { voiceId: string } }>("/api/voice/reference", body);
      await loadVoices();
      if (current()) {
        setMapping(previous => ({ ...previous, [lane]: `library:${registered.voice.voiceId}` }));
        setSampleLane("");
        setResult(undefined);
        setCompare("original");
      }
    });
  }

  async function convert() {
    if (!analysis) return;
    await act("Converting selected speech…", async current => {
      const voiceMappings = selectedLanes.map(lane => ({
        voiceId: lane.id, targetVoiceId: mapping[lane.id],
        ...(lane.needsCharacterConfirmation ? { characterId: confirmed[lane.id] } : {}),
      }));
      const payload = { fixVoices: true, analysisId: analysis.analysisId, voiceMappings };
      let request: object | FormData = payload;
      if (take && mapping[take.voiceId]) {
        const body = new FormData();
        body.set("payload", JSON.stringify(payload));
        body.set("take", take.file);
        body.set("takeVoiceId", take.voiceId);
        body.set("takeSegmentIndex", String(take.segmentIndex));
        request = body;
      }
      setSavedUrl("");
      setCompare("original");
      const corrected = await testingVoiceRequest<Result>(dubEndpoint, request);
      if (current()) {
        setPendingLevels({});
        setPendingMatch(undefined);
        setPendingFineTune({});
        setFineTuneCue(0);
        setResult(corrected);
      }
    });
  }

  function capturePosition() {
    const current = video.current;
    comparePoint.current = current ? { time: current.currentTime, playing: !current.paused, volume: current.volume, muted: current.muted } : null;
  }

  function switchVersion(next: CompareVersion) {
    if (next === compare) return;
    capturePosition();
    setCompare(next);
  }

  function restoreTime(event: React.SyntheticEvent<HTMLVideoElement>) {
    const player = event.currentTarget;
    const point = comparePoint.current;
    comparePoint.current = null;
    if (!point) return;
    if (point.volume !== undefined) player.volume = point.volume;
    if (point.muted !== undefined) player.muted = point.muted;
    player.currentTime = Math.min(point.time, player.duration);
    if (point.playing) void player.play().catch(() => {});
  }

  function playSample(lane: Lane) {
    if (!lane.sampleUrl) return;
    audition.current?.pause();
    video.current?.pause();
    audition.current = new Audio(lane.sampleUrl);
    void audition.current.play().catch(() => setError("This speaker preview could not play."));
  }

  const unadjustedUrl = result?.unadjustedVideoUrl;
  const source = (compare === "converted" ? result?.previewVideoUrl : compare === "unadjusted" ? unadjustedUrl : undefined) || analysis?.sourceVideoUrl;
  const appliedLevels = new Map(result?.renderedSegments?.map(segment => [segment.voiceId, segment.levelDb ?? 0]));
  const adjustableLanes = analysis?.voices.filter(lane => appliedLevels.has(lane.id)) || [];
  const reviewedLevel = (laneId: string) => pendingLevels[laneId] ?? appliedLevels.get(laneId) ?? 0;
  const levelsChanged = adjustableLanes.some(lane => reviewedLevel(lane.id) !== appliedLevels.get(lane.id));
  const appliedMatch = result?.matchOriginalScene === true;
  const matchOriginalScene = pendingMatch ?? appliedMatch;
  const cues = result?.renderedSegments?.map((segment, index) => ({...segment, cueIndex: segment.cueIndex ?? index})) || [];
  const selectedCue = cues.find(cue => cue.cueIndex === fineTuneCue) || cues[0];
  const cueSettings = (cue: typeof cues[number]) => pendingFineTune[cue.cueIndex] ?? cue.fineTune ?? automaticTune;
  const adjustmentsChanged = matchOriginalScene && cues.some(cue => {
    const applied = cue.fineTune ?? automaticTune;
    const pending = cueSettings(cue);
    return applied.distance !== pending.distance || applied.reflections !== pending.reflections;
  });
  const previewChanged = levelsChanged || matchOriginalScene !== appliedMatch || adjustmentsChanged;

  async function updatePreview(reset = false) {
    if (!result?.previewId || (!reset && !previewChanged)) return;
    await act("Updating converted preview…", async current => {
      const useMatch = reset || matchOriginalScene;
      const speakerLevels = reset ? [] : adjustableLanes.map(lane => ({voiceId: lane.id, levelDb: reviewedLevel(lane.id)}));
      const cueAdjustments = !reset && useMatch ? cues.map(cue => ({cueIndex: cue.cueIndex, ...cueSettings(cue)}))
        .filter(cue => cue.distance || cue.reflections) : [];
      const remixed = await testingVoiceRequest<Result>(dubEndpoint, {
        fixVoices: true, action: "remix", previewId: result.previewId, speakerLevels, matchOriginalScene: useMatch, cueAdjustments,
      });
      if (current()) {
        capturePosition();
        setPendingLevels({});
        setPendingMatch(undefined);
        setPendingFineTune({});
        setResult(remixed);
        setCompare("converted");
        setSavedUrl("");
      }
    });
  }
  const selectedLanes = analysis?.voices.filter(lane => mapping[lane.id] &&
    (!lane.needsCharacterConfirmation || confirmed[lane.id]) && lane.segments.some(segment => !segment.blockedReason)) || [];
  function selectVoice(laneId: string, target: string) {
    setMapping(current => ({ ...current, [laneId]: target }));
    setResult(undefined);
    setCompare("original");
    setSavedUrl("");
  }
  const eligibleTakeLanes = selectedLanes;
  const actingLane = eligibleTakeLanes.find(lane => lane.id === takeSelection.voiceId) || eligibleTakeLanes[0];
  const selectedSegment = actingLane?.segments[takeSelection.segmentIndex];
  const actingIndex = selectedSegment && !selectedSegment.blockedReason ? takeSelection.segmentIndex : actingLane?.segments.findIndex(segment => !segment.blockedReason) || 0;
  const actingSegment = actingLane?.segments[actingIndex];
  const warnings = Array.from(new Set([...analysis?.warnings || [], ...result?.warnings || [],
    ...cues.flatMap(cue => cue.fineTuneWarning ? [`${timestamp(cue.start)} · ${cue.fineTuneWarning}`] : [])]));
  return <article id={compact ? undefined : "testing-fix-voices"} className="min-w-0 space-y-4 rounded-2xl border border-cyan-300/25 bg-cyan-950/15 p-4">
    {!compact && <><header><h2 className="text-lg font-semibold">Change Voice</h2><p className="text-sm text-white/65">Choose a 4–12 second clip.</p></header>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={button} disabled={!!busy} onClick={() => void selectGallery()}>{gallery ? "Close Gallery" : "Choose from Gallery"}</button>
      <label className="min-w-0 text-sm">Upload video<input type="file" className={field} disabled={!!busy} accept="video/*,.mp4,.webm,.mov,.mkv" onChange={event => {
        const file = event.target.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;
        const body = new FormData();
        body.set("fixVoices", "true");
        body.set("video", file);
        void analyze(body);
      }} /></label>
    </div>
    {gallery && <div className="max-h-48 space-y-1 overflow-auto rounded-lg border border-white/20 p-2" aria-label="Gallery videos">
      {gallery.length ? gallery.map(clip => <button type="button" key={clip.url} className={button + " block w-full break-words text-left"} disabled={!!busy}
        onClick={() => void analyze({ fixVoices: true, sourceFileName: clip.fileName, sourceScope: clip.source })}>{clip.name}</button>)
        : <p className="text-sm text-white/65">No Gallery videos found.</p>}
    </div>}</>}
    {result?.previewVideoUrl && <div className="flex gap-2" aria-label="Compare voice correction">
      <button type="button" className={button + (compare === "original" ? " bg-white/15" : "")} aria-pressed={compare === "original"} onClick={() => switchVersion("original")}>Original</button>
      {unadjustedUrl && unadjustedUrl !== result.previewVideoUrl && <button type="button" className={button + (compare === "unadjusted" ? " bg-white/15" : "")}
        aria-pressed={compare === "unadjusted"} onClick={() => switchVersion("unadjusted")}>Unadjusted</button>}
      <button type="button" className={button + (compare === "converted" ? " bg-white/15" : "")} aria-pressed={compare === "converted"} onClick={() => switchVersion("converted")}>Converted</button>
    </div>}
    {source && <video ref={video} key={source} className="max-h-80 w-full rounded-xl bg-black" src={source} aria-label={compare === "converted" ? "Converted clip" : compare === "unadjusted" ? "Unadjusted clip" : "Original clip"}
      controls playsInline preload="metadata" onPlay={() => audition.current?.pause()} onLoadedMetadata={restoreTime} />}
    {result?.previewVideoUrl && adjustableLanes.length > 0 && <details className="rounded-lg border border-white/15 p-2">
      <summary className="cursor-pointer p-1 text-sm font-medium">Fine-Tune</summary>
      <fieldset disabled={!!busy} className="space-y-3 px-1 pb-1 pt-2">
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-cyan-300" checked={matchOriginalScene}
            onChange={event => setPendingMatch(event.target.checked)} />
          Match Original Scene
        </label>
        <p className="text-sm font-medium">Voice Levels</p>
        {adjustableLanes.map(lane => {
          const level = reviewedLevel(lane.id);
          const label = level === 0 ? "Match original" : `${level > 0 ? "+" : ""}${level} dB`;
          return <label className="block text-sm" key={lane.id}>
            <span className="flex justify-between gap-2"><span>{lane.label}</span><span className="text-white/70">{label}</span></span>
            <input type="range" className="min-h-7 w-full accent-cyan-300" aria-label={`${lane.label} voice level`} aria-valuetext={label}
              min={MIN_VOICE_LEVEL_DB} max={MAX_VOICE_LEVEL_DB} step={1} value={level}
              onChange={event => {
                const value = Number(event.target.value);
                setPendingLevels(current => ({...current, [lane.id]: value}));
              }} />
          </label>;
        })}
        {matchOriginalScene && selectedCue && <>
          {cues.length > 1 && <label className="block text-sm">Dialogue line
            <select className={field} value={selectedCue.cueIndex} onChange={event => setFineTuneCue(Number(event.target.value))}>
              {cues.map(cue => <option key={cue.cueIndex} value={cue.cueIndex}>
                {analysis?.voices.find(lane => lane.id === cue.voiceId)?.label || "Speaker"} · {timestamp(cue.start)}–{timestamp(cue.end)}
              </option>)}
            </select>
          </label>}
          {([
            {key:"distance", title:"Distance", left:"Near", right:"Far"},
            {key:"reflections", title:"Room / Echo", left:"Dry", right:"More reflections"},
          ] as const).map(({key, title, left, right}) => {
            const value = cueSettings(selectedCue)[key];
            const label = value === 0 ? "Automatic" : value > 0 ? right : left;
            return <label key={key} className="block text-sm">
              <span className="flex justify-between gap-2"><span>{title}</span><span className="text-white/70">{label}</span></span>
              <input type="range" className="min-h-7 w-full accent-cyan-300" aria-label={title} aria-valuetext={label}
                min={-MAX_SCENE_FINE_TUNE} max={MAX_SCENE_FINE_TUNE} step={1} value={value} onChange={event => {
                  const next = Number(event.target.value);
                  setPendingFineTune(current => ({...current, [selectedCue.cueIndex]: {...cueSettings(selectedCue), [key]:next}}));
                }} />
              <span className="flex justify-between text-xs text-white/65"><span>{left}</span><span>{right}</span></span>
            </label>;
          })}
        </>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={!previewChanged} onClick={() => void updatePreview()}>Update Preview</button>
          {(levelsChanged || adjustmentsChanged || cues.some(cue => cue.levelDb || cue.fineTune?.distance || cue.fineTune?.reflections)) &&
            <button type="button" className={button} onClick={() => void updatePreview(true)}>Reset to Automatic</button>}
        </div>
      </fieldset>
    </details>}
    {busy && <p role="status" className="text-sm text-white/70">{busy}</p>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {message && <p role="status" className="text-sm text-white/70">{message}</p>}
    {warnings.length > 0 && <ul className="space-y-1 text-sm text-amber-200">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    {!!result?.skippedSegments?.length && <ul className="space-y-1 text-sm text-amber-200">
      {result.skippedSegments.map((segment, index) => <li key={index}>{timestamp(segment.start)}–{timestamp(segment.end)} kept original. {segment.reason || segment.blockedReason}</li>)}
    </ul>}
    {analysis && <fieldset disabled={!!busy} className="min-w-0 space-y-2">
      {analysis.voices.map(lane => {
        const character = analysis.cast?.find(item => item.characterId === confirmed[lane.id]);
        const suggestedVoice = lane.needsCharacterConfirmation ? character?.voiceId : lane.suggestedTargetVoiceId;
        const suggestedName = lane.needsCharacterConfirmation ? character?.voiceName : lane.suggestedTargetVoiceName;
        const editable = lane.segments.some(segment => !segment.blockedReason);
        return <div key={lane.id} className="space-y-2 rounded-lg border border-white/10 p-2">
        <div className="flex flex-wrap items-center gap-2 text-sm"><strong className="mr-auto">{lane.label}</strong>
          {lane.sampleUrl && <button type="button" className={button} onClick={() => playSample(lane)}>Play speaker</button>}
        </div>
        {editable && lane.needsCharacterConfirmation && <label className="block text-sm">Who spoke?
          <select className={field} value={confirmed[lane.id] || ""} onChange={event => {
            const characterId = event.target.value;
            setConfirmed(current => ({ ...current, [lane.id]: characterId }));
            selectVoice(lane.id, "");
          }}>
            <option value="">Confirm character</option>
            {analysis.cast?.map(member => <option key={member.characterId} value={member.characterId}>{member.name}</option>)}
          </select>
        </label>}
        <label className="sr-only" htmlFor={`fix-voice-${lane.id}`}>Replacement for {lane.label}</label>
        {!lane.segments.some(segment => !segment.blockedReason) &&
          <p className="text-sm text-amber-200">Keeping this speaker: {lane.segments.find(segment => segment.blockedReason)?.blockedReason || "No isolated speech is available."}</p>}
        <select id={`fix-voice-${lane.id}`} className={field} value={mapping[lane.id] || ""}
          disabled={!editable || (lane.needsCharacterConfirmation && !confirmed[lane.id])} onChange={event => selectVoice(lane.id, event.target.value)}>
          <option value="">Keep Original</option>
          {suggestedVoice && <option value={suggestedVoice}>{suggestedName || "Saved character voice"} (suggested)</option>}
          {voices.filter(voice => voice.id !== suggestedVoice).map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
        </select>
        {!compact && <button type="button" className="text-sm text-cyan-200 underline disabled:opacity-40" disabled={!lane.segments.some(segment => !segment.blockedReason)} onClick={() => setSampleLane(sampleLane === lane.id ? "" : lane.id)}>Use a new voice sample</button>}
        {sampleLane === lane.id && <input type="file" aria-label="Clean character voice sample" className={field} accept="audio/*,.wav,.m4a" onChange={event => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (file) void registerVoice(file, lane.id);
        }} />}
      </div>; })}
      {!analysis.voices.length && <p className="text-sm text-white/70">No usable speech was detected.</p>}
      {!compact && actingLane && actingSegment && <details>
        <summary className="cursor-pointer text-sm text-cyan-200">Record or Upload a Take</summary>
        <div className="mt-2 space-y-2">
          {eligibleTakeLanes.length > 1 && <label className="block text-sm">Speaker for this take<select className={field} value={actingLane.id} onChange={event => {
            setTakeSelection({ voiceId: event.target.value, segmentIndex: 0 }); setTake(undefined);
          }}>{eligibleTakeLanes.map(lane => <option key={lane.id} value={lane.id}>{lane.label}</option>)}</select></label>}
          {actingLane.segments.length > 1 && <label className="block text-sm">Line<select className={field} value={actingIndex} onChange={event => {
            setTakeSelection({ voiceId: actingLane.id, segmentIndex: Number(event.target.value) }); setTake(undefined);
          }}>{actingLane.segments.map((segment, index) => <option key={index} value={index} disabled={Boolean(segment.blockedReason)}>{timestamp(segment.start)}–{timestamp(segment.end)} {segment.text || ""}</option>)}</select></label>}
          {!!actingSegment.text && <p className="text-sm text-white/80">{actingSegment.text}</p>}
          <button type="button" className={button} onClick={() => {
            switchVersion("original");
            if (compare !== "original") { comparePoint.current = { time: actingSegment.start, playing: true }; return; }
            if (video.current) { video.current.currentTime = actingSegment.start; void video.current.play().catch(() => {}); }
          }}>Play cue</button>
          <TakeInput key={`${actingLane.id}-${actingIndex}`} value={take?.voiceId === actingLane.id && take?.segmentIndex === actingIndex ? take.file : undefined} disabled={!!busy} onChange={file => {
            setTake(file ? { voiceId: actingLane.id, segmentIndex: actingIndex, file } : undefined);
            setResult(undefined); setCompare("original"); setSavedUrl("");
          }} />
        </div>
      </details>}
      <button type="button" className={button + " bg-cyan-800"} disabled={!selectedLanes.length || !analysis.mixReady} onClick={() => void convert()}>Convert</button>
    </fieldset>}
    {result?.previewId && result.previewVideoUrl && <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!!busy || !!savedUrl || previewChanged} onClick={() => void act("Saving…", async current => {
        const saved = await testingVoiceRequest<{ url: string }>(dubEndpoint, { fixVoices: true, action: "save", previewId: result.previewId });
        if (current()) { setSavedUrl(saved.url); setMessage("Saved a separate clip to Gallery."); }
      })}>Save to Gallery</button>
      {!compact && !previewChanged && <a className={button} href={`${result.previewVideoUrl}${result.previewVideoUrl.includes("?") ? "&" : "?"}download=1`}>Download</a>}
    </div>}
  </article>;
}
