"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { StoryProductionPlanRecord } from "@/lib/storyCreator/productionPlan";
import type {
  StoryAudioAsset,
  StoryAudioBatch,
  StoryAudioKind,
  StoryAudioShotContext,
  StoryVoiceAssignment,
} from "@/lib/storyCreator/audioProductionTypes";
import type { StoryProductionMode } from "./StoryStudioShell";

type Props = {
  projectId: string;
  record: StoryProductionPlanRecord | null;
  mode: StoryProductionMode;
};

type VoiceOption = { voiceId: string; name: string; type: string; tags: string[] };
type ApprovedVisualOption = { versionId: string; assetId: string; name: string; kind: string };
type Snapshot = {
  context: StoryAudioShotContext | null;
  assignments: StoryVoiceAssignment[];
  assets: StoryAudioAsset[];
  batches: StoryAudioBatch[];
  voices: VoiceOption[];
  approvedVisuals: ApprovedVisualOption[];
};

const kinds: Array<{ value: StoryAudioKind; label: string }> = [
  { value: "dialogue", label: "Dialogue" },
  { value: "narration", label: "Narration" },
  { value: "sound-effect", label: "Sound Effect" },
  { value: "ambience", label: "Ambience" },
  { value: "music", label: "Music" },
  { value: "mix", label: "Audio Mix" },
  { value: "enhancement", label: "Enhance Audio" },
  { value: "lip-sync", label: "Audio-Driven Video" },
];

const emotions = ["Calm", "Happy", "Sad", "Angry", "Frightened", "Whispered", "Excited", "Serious", "Dramatic", "Custom"];

function requestKey(prefix: string) {
  try { return `${prefix}-${crypto.randomUUID()}`; } catch { return `${prefix}-${Date.now()}`; }
}

export function StoryAudioProductionStudio({ projectId, record, mode }: Props) {
  const scenes = useMemo(() => record?.plan.acts.flatMap((act) => act.scenes) || [], [record]);
  const [sceneId, setSceneId] = useState("");
  const scene = scenes.find((item) => item.id === sceneId) || scenes[0] || null;
  const [shotId, setShotId] = useState("");
  const shot = scene?.shots.find((item) => item.id === shotId) || scene?.shots[0] || null;
  const [snapshot, setSnapshot] = useState<Snapshot>({ context: null, assignments: [], assets: [], batches: [], voices: [], approvedVisuals: [] });
  const [kind, setKind] = useState<StoryAudioKind>("dialogue");
  const [speaker, setSpeaker] = useState("");
  const [exactText, setExactText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [emotion, setEmotion] = useState("Serious");
  const [delivery, setDelivery] = useState("");
  const [startSeconds, setStartSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [directorInstruction, setDirectorInstruction] = useState("");
  const [voiceCharacter, setVoiceCharacter] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [authorizedReference, setAuthorizedReference] = useState(false);
  const [preparedAssetId, setPreparedAssetId] = useState("");
  const [batchLimit, setBatchLimit] = useState(20);
  const [visualVersionId, setVisualVersionId] = useState("");
  const [sourceAudioAssetId, setSourceAudioAssetId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!projectId) return;
    if (!quiet) setError("");
    const query = new URLSearchParams({ projectId });
    if (scene?.id && shot?.id) {
      query.set("sceneId", scene.id);
      query.set("shotId", shot.id);
    }
    const response = await fetch(`/api/story-creator/audio-production?${query}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not load Story audio production.");
    setSnapshot({
      context: data.context || null,
      assignments: data.assignments || [],
      assets: data.assets || [],
      batches: data.batches || [],
      voices: data.voices || [],
      approvedVisuals: data.approvedVisuals || [],
    });
  }, [projectId, scene, shot]);

  useEffect(() => {
    if (!sceneId && scenes[0]) setSceneId(scenes[0].id);
  }, [sceneId, scenes]);

  useEffect(() => {
    if (!shotId || !scene?.shots.some((item) => item.id === shotId)) setShotId(scene?.shots[0]?.id || "");
  }, [scene, shotId]);

  useEffect(() => {
    void load().catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)));
  }, [load]);

  useEffect(() => {
    const line = snapshot.context?.shot.dialogue[0];
    if (!line) return;
    setSpeaker(line.speaker);
    setExactText(line.line);
    setDelivery(line.delivery);
    if (!voiceCharacter) setVoiceCharacter(line.speaker);
  }, [snapshot.context, voiceCharacter]);

  const active = snapshot.assets.some((asset) => ["queued", "running"].includes(asset.status));
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(true).catch(() => undefined), 4_000);
    return () => window.clearInterval(timer);
  }, [active, load]);

  async function action(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/story-creator/audio-production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...body }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Audio production action failed.");
      await load(true);
      return data;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    } finally {
      setBusy("");
    }
  }

  async function assignVoice() {
    if (!voiceCharacter || !voiceId) return;
    const data = await action({
      action: "assign-voice",
      characterName: voiceCharacter,
      voiceId,
      variant: "default",
      speakingStyle: delivery,
      stability: 0.7,
      authorizedReference,
    }, "assign-voice");
    if (data) setNotice(`Voice assigned to ${voiceCharacter}.`);
  }

  async function prepare() {
    if (!record || !scene || !shot) return;
    const assignment = snapshot.assignments.find((item) => item.characterKey === speaker.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    const data = await action({
      action: "prepare-asset",
      planVersion: record.version,
      sceneId: scene.id,
      shotId: shot.id,
      kind,
      speakerName: speaker,
      exactText,
      prompt,
      emotion,
      delivery,
      startSeconds,
      durationSeconds,
      voiceAssignmentId: assignment?.id,
      videoTakeId: snapshot.context?.acceptedVideoTakeIds[0] || null,
      keepOriginalAudio: true,
      visualVersionId: kind === "lip-sync" ? visualVersionId : undefined,
      sourceAudioAssetId: kind === "lip-sync" ? sourceAudioAssetId : undefined,
      idempotencyKey: requestKey("story-audio"),
    }, "prepare");
    if (data?.asset) {
      setPreparedAssetId(data.asset.id);
      setNotice("Audio operation prepared. No generation has started.");
    }
  }

  async function prepareDirectorAction() {
    if (!scene || !shot || !directorInstruction.trim()) return;
    const data = await action({
      action: "director-action",
      sceneId: scene.id,
      shotId: shot.id,
      instruction: directorInstruction,
      idempotencyKey: requestKey("story-audio-director"),
    }, "director");
    if (data?.asset) {
      setPreparedAssetId(data.asset.id);
      setNotice("Story Director prepared the requested audio action. No generation has started.");
    }
  }

  async function authorizeAsset(assetId: string) {
    const data = await action({ action: "authorize-asset", assetId, authorized: true }, `authorize-${assetId}`);
    if (data) setNotice("Audio job authorized and dispatched to its configured provider.");
  }

  async function prepareBatch() {
    if (!record || !scene) return;
    const data = await action({
      action: "prepare-batch",
      sceneIds: [scene.id],
      maxJobs: batchLimit,
      idempotencyKey: requestKey("story-audio-batch"),
    }, "prepare-batch");
    if (data) setNotice("Scene audio batch prepared. No jobs have started.");
  }

  async function authorizeBatch(batchId: string) {
    const data = await action({ action: "authorize-batch", batchId, authorized: true }, `authorize-batch-${batchId}`);
    if (data) setNotice("Scene audio batch authorized and dispatched within its approved job limit.");
  }

  const selectedLineIndex = snapshot.context?.shot.dialogue.findIndex((line) => line.speaker === speaker && line.line === exactText) ?? -1;

  if (!record) {
    return <p className="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-white/55">Create and save a production plan before preparing audio.</p>;
  }

  return (
    <section aria-label="Story Audio Production" className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/55">Audio Production</p>
          <h2 className="mt-1 text-xl font-black text-white">Dialogue, music, sound, and sync</h2>
          <p className="mt-1 text-sm text-white/48">Prepare exact dialogue and non-destructive audio versions for each shot.</p>
        </div>
        <div className="text-xs font-bold text-white/40">Plan v{record.version} · {mode}</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-white/55">Scene
          <select aria-label="Audio Scene" value={scene?.id || ""} onChange={(event) => setSceneId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white">
            {scenes.map((item) => <option key={item.id} value={item.id}>Scene {item.sceneNumber}: {item.title}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-white/55">Shot
          <select aria-label="Audio Shot" value={shot?.id || ""} onChange={(event) => setShotId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white">
            {scene?.shots.map((item) => <option key={item.id} value={item.id}>Shot {item.shotNumber}: {item.description}</option>)}
          </select>
        </label>
      </div>

      <div className="border-y border-white/10 py-4">
        <label className="text-xs font-bold text-white/55">Tell Story Director
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input aria-label="Tell Story Director Audio Action" value={directorInstruction} onChange={(event) => setDirectorInstruction(event.target.value)} placeholder="Generate the dialogue more slowly, then add rain." className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white" />
            <button type="button" disabled={!directorInstruction.trim() || Boolean(busy)} onClick={() => void prepareDirectorAction()} className="min-h-11 rounded-lg bg-cyan-300 px-4 text-sm font-black text-black disabled:opacity-40">Prepare Action</button>
          </div>
        </label>
      </div>

      <details className="rounded-lg border border-white/10 bg-black/20 p-4">
        <summary className="cursor-pointer text-sm font-black text-white">Character Voice Assignment</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-white/55">Character
            <input value={voiceCharacter} onChange={(event) => setVoiceCharacter(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white" />
          </label>
          <label className="text-xs font-bold text-white/55">Voice
            <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white">
              <option value="">Choose an existing voice</option>
              {snapshot.voices.map((voice) => <option key={voice.voiceId} value={voice.voiceId}>{voice.name} · {voice.type}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-white/68">
          <input type="checkbox" checked={authorizedReference} onChange={(event) => setAuthorizedReference(event.target.checked)} />
          I am authorized to use this voice reference
        </label>
        <button type="button" disabled={!voiceCharacter || !voiceId || !authorizedReference || Boolean(busy)} onClick={() => void assignVoice()} className="mt-3 min-h-11 rounded-lg border border-cyan-200/35 bg-cyan-300/10 px-4 text-sm font-black text-cyan-50 disabled:opacity-40">Assign Voice</button>
        {snapshot.assignments.length ? <div className="mt-3 text-xs text-white/45">{snapshot.assignments.map((item) => `${item.characterName}: ${item.voiceName}`).join(" · ")}</div> : null}
      </details>

      <div className="space-y-3 border-y border-white/10 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-white/55">Operation
            <select value={kind} onChange={(event) => setKind(event.target.value as StoryAudioKind)} className="mt-1 min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white">
              {kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-white/55">Emotion
            <select value={emotion} onChange={(event) => setEmotion(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white">
              {emotions.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-white/55">Start
            <input type="number" min={0} step={0.1} value={startSeconds} onChange={(event) => setStartSeconds(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white" />
          </label>
          <label className="text-xs font-bold text-white/55">Duration
            <input type="number" min={0.5} step={0.1} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white" />
          </label>
        </div>

        {(kind === "dialogue" || kind === "narration") ? (
          <>
            {snapshot.context?.shot.dialogue.length ? (
              <label className="block text-xs font-bold text-white/55">Approved dialogue line
                <select value={selectedLineIndex} onChange={(event) => {
                  const line = snapshot.context?.shot.dialogue[Number(event.target.value)];
                  if (line) { setSpeaker(line.speaker); setExactText(line.line); setDelivery(line.delivery); }
                }} className="mt-1 min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white">
                  {snapshot.context.shot.dialogue.map((line, index) => <option key={`${line.speaker}-${index}`} value={index}>{line.speaker}: {line.line}</option>)}
                </select>
              </label>
            ) : <p className="text-sm text-amber-100/70">This shot has no approved dialogue. Add dialogue to the production plan or prepare narration manually.</p>}
            <label className="block text-xs font-bold text-white/55">Exact spoken words
              <textarea value={exactText} onChange={(event) => setExactText(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-white/12 bg-black/40 p-3 text-sm text-white" />
            </label>
            <label className="block text-xs font-bold text-white/55">Delivery direction
              <input value={delivery} onChange={(event) => setDelivery(event.target.value)} placeholder="Slow, restrained, pause before the final sentence." className="mt-1 min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white" />
            </label>
          </>
        ) : (
          <>
            <label className="block text-xs font-bold text-white/55">Description
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder="Describe the music, sound, ambience, or edit." className="mt-1 w-full rounded-lg border border-white/12 bg-black/40 p-3 text-sm text-white" />
            </label>
            {kind === "lip-sync" ? <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-white/55">Approved character image
                <select value={visualVersionId} onChange={(event) => setVisualVersionId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white">
                  <option value="">Choose an approved image</option>
                  {snapshot.approvedVisuals.map((visual) => <option key={visual.versionId} value={visual.versionId}>{visual.name} · {visual.kind}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-white/55">Completed dialogue audio
                <select value={sourceAudioAssetId} onChange={(event) => setSourceAudioAssetId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white">
                  <option value="">Choose completed dialogue</option>
                  {snapshot.assets.filter((asset) => asset.kind === "dialogue" && ["completed", "accepted", "rejected"].includes(asset.status)).map((asset) => <option key={asset.id} value={asset.id}>{asset.speakerName || "Dialogue"} · v{asset.version}</option>)}
                </select>
              </label>
            </div> : null}
          </>
        )}

        <button type="button" disabled={Boolean(busy) || ((kind === "dialogue" || kind === "narration") && !exactText.trim()) || (kind === "lip-sync" && (!visualVersionId || !sourceAudioAssetId))} onClick={() => void prepare()} className="min-h-11 rounded-lg bg-white px-4 text-sm font-black text-black disabled:opacity-40">Prepare Audio</button>
        <p className="text-xs text-white/40">Preparation does not start a provider, GPU, or paid request.</p>
      </div>

      {error ? <p role="alert" className="rounded-lg border border-rose-300/25 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</p> : null}
      {notice ? <p className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">{notice}</p> : null}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-white">Scene audio batch</h3>
            <p className="text-xs text-white/42">Missing voice assignments remain blocked instead of being silently substituted.</p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs font-bold text-white/55">Maximum jobs
              <input type="number" min={1} max={100} value={batchLimit} onChange={(event) => setBatchLimit(Number(event.target.value))} className="mt-1 block h-10 w-24 rounded-lg border border-white/12 bg-black/40 px-2 text-white" />
            </label>
            <button type="button" disabled={Boolean(busy)} onClick={() => void prepareBatch()} className="min-h-10 rounded-lg border border-white/12 bg-white/[0.05] px-3 text-sm font-black text-white">Prepare Scene Audio</button>
          </div>
        </div>
        {snapshot.batches.length ? <div className="mt-3 space-y-2">{snapshot.batches.map((batch) => (
          <div key={batch.id} className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-white/55">
              <span className="font-black text-white">{batch.status}</span> · {batch.assetIds.length} prepared · limit {batch.maxJobs}
              {Number(batch.workload.blockedVoiceAssignments || 0) > 0 ? <span className="ml-2 text-amber-200">{batch.workload.blockedVoiceAssignments} blocked voice assignment(s)</span> : null}
            </div>
            {batch.status === "prepared" ? <button type="button" disabled={Boolean(busy) || batch.assetIds.length === 0} onClick={() => void authorizeBatch(batch.id)} className="min-h-10 rounded-lg bg-cyan-300 px-3 text-sm font-black text-black disabled:opacity-40">Approve &amp; Generate Batch</button> : null}
          </div>
        ))}</div> : null}
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-black text-white">Audio versions</h3>
        {!snapshot.assets.length ? <p className="text-sm text-white/45">No audio operations prepared for this shot.</p> : snapshot.assets.map((asset) => (
          <article key={asset.id} className={`rounded-lg border p-4 ${asset.id === preparedAssetId ? "border-cyan-200/35 bg-cyan-300/[0.06]" : "border-white/10 bg-black/25"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase text-cyan-100/55">{asset.kind} · v{asset.version}</div>
                <div className="mt-1 text-sm font-black text-white">{asset.speakerName || asset.providerContract.provider}</div>
                {asset.exactText ? <p className="mt-2 text-sm text-white/72">“{asset.exactText}”</p> : <p className="mt-2 text-sm text-white/62">{asset.prompt}</p>}
              </div>
              <span className="rounded-md border border-white/10 px-2 py-1 text-xs font-bold text-white/55">{asset.status}</span>
            </div>
            <div className="mt-3 text-xs text-white/42">{asset.providerContract.provider} · starts {asset.startSeconds.toFixed(1)}s {asset.durationSeconds != null ? `· ${asset.durationSeconds.toFixed(1)}s` : "· duration pending"}</div>
            {asset.timingConflict ? <p className="mt-2 text-xs font-bold text-amber-200">Timing conflict: this audio exceeds the shot duration.</p> : null}
            {asset.providerContract.limitations.length ? <details className="mt-3 text-xs text-white/48"><summary className="cursor-pointer font-bold">Technical details</summary><ul className="mt-2 space-y-1">{asset.providerContract.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
            {asset.outputPath ? (["sound-effect", "ambience", "mix", "enhancement", "lip-sync"].includes(asset.kind)
              ? <video controls preload="metadata" className="mt-3 w-full rounded-lg"><source src={`/api/story-creator/audio-production/media?projectId=${encodeURIComponent(projectId)}&assetId=${encodeURIComponent(asset.id)}`} /></video>
              : <audio controls preload="metadata" className="mt-3 w-full"><source src={`/api/story-creator/audio-production/media?projectId=${encodeURIComponent(projectId)}&assetId=${encodeURIComponent(asset.id)}`} /></audio>) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {asset.status === "prepared" ? <button type="button" disabled={Boolean(busy)} onClick={() => void authorizeAsset(asset.id)} className="min-h-10 rounded-lg bg-cyan-300 px-3 text-sm font-black text-black">Generate</button> : null}
              {["completed", "accepted", "rejected"].includes(asset.status) ? <>
                <button type="button" onClick={() => void action({ action: "accept-asset", assetId: asset.id }, `accept-${asset.id}`)} className="min-h-10 rounded-lg border border-emerald-300/30 px-3 text-sm font-black text-emerald-100">Keep</button>
                <button type="button" onClick={() => void action({ action: "reject-asset", assetId: asset.id }, `reject-${asset.id}`)} className="min-h-10 rounded-lg border border-rose-300/25 px-3 text-sm font-black text-rose-100">Reject</button>
                <button type="button" onClick={() => void action({ action: "revise-asset", assetId: asset.id, emotion, delivery, idempotencyKey: requestKey("story-audio-revision") }, `revise-${asset.id}`)} className="min-h-10 rounded-lg border border-white/12 px-3 text-sm font-black text-white">Try Again</button>
              </> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
