"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { StoryProductionPlanRecord } from "@/lib/storyCreator/productionPlan";
import type {
  StoryVideoBatch,
  StoryVideoMethod,
  StoryVideoShotContext,
  StoryVideoTake,
} from "@/lib/storyCreator/videoProductionTypes";
import type { StoryProductionMode } from "./StoryStudioShell";

type Props = {
  projectId: string;
  record: StoryProductionPlanRecord | null;
  mode: StoryProductionMode;
};

type Snapshot = {
  takes: StoryVideoTake[];
  batches: StoryVideoBatch[];
  context: StoryVideoShotContext | null;
};

const methodLabels: Record<StoryVideoMethod, string> = {
  "text-to-video": "Text to Video",
  "image-to-video": "Image to Video",
  "reference-to-video": "Reference to Video",
  "video-edit": "Edit Accepted Video",
};

const activeStatuses = new Set([
  "queued",
  "claimed",
  "running",
  "postprocessing",
]);

function requestKey(prefix: string) {
  try { return `${prefix}-${crypto.randomUUID()}`; } catch { return `${prefix}-${Date.now()}`; }
}

export function StoryVideoProductionStudio({ projectId, record, mode }: Props) {
  const scenes = useMemo(
    () => record?.plan.acts.flatMap((act) => act.scenes) || [],
    [record],
  );
  const [sceneId, setSceneId] = useState("");
  const selectedScene = scenes.find((scene) => scene.id === sceneId) || scenes[0] || null;
  const [shotId, setShotId] = useState("");
  const selectedShot = selectedScene?.shots.find((shot) => shot.id === shotId)
    || selectedScene?.shots[0]
    || null;
  const [snapshot, setSnapshot] = useState<Snapshot>({ takes: [], batches: [], context: null });
  const [method, setMethod] = useState<StoryVideoMethod>("text-to-video");
  const [motion, setMotion] = useState("");
  const [directorInstruction, setDirectorInstruction] = useState("");
  const [duration, setDuration] = useState<5 | 10>(5);
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [quality, setQuality] = useState<"sh" | "lq" | "hq">("lq");
  const [seed, setSeed] = useState("");
  const [selectedReferences, setSelectedReferences] = useState<string[]>([]);
  const [visualStyle, setVisualStyle] = useState<"none" | "realism" | "gurren">("none");
  const [combatMode, setCombatMode] = useState<"off" | "normal" | "high-action" | "finisher">("off");
  const [singularity, setSingularity] = useState(false);
  const [motionRepair, setMotionRepair] = useState(false);
  const [rife, setRife] = useState(false);
  const [preparedTakeId, setPreparedTakeId] = useState("");
  const [batchLimit, setBatchLimit] = useState(8);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!projectId) return;
    if (!quiet) setError("");
    const query = new URLSearchParams({ projectId });
    if (selectedScene?.id && selectedShot?.id) {
      query.set("sceneId", selectedScene.id);
      query.set("shotId", selectedShot.id);
    }
    const response = await fetch(`/api/story-creator/video-production?${query.toString()}`, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not load video production.");
    setSnapshot({ takes: data.takes || [], batches: data.batches || [], context: data.context || null });
    if (data.context) {
      const context = data.context as StoryVideoShotContext;
      setDuration(context.shot.requestedDurationSeconds);
      if (mode !== "manual") setMethod(context.recommendedMethod);
      const defaults = context.recommendedMethod === "image-to-video"
        ? context.availableReferences.filter((reference) => ["storyboard", "scene_image", "shot_reference"].includes(reference.kind)).slice(0, 1)
        : context.recommendedMethod === "reference-to-video"
          ? context.availableReferences
          : [];
      setSelectedReferences(defaults.map((reference) => reference.versionId));
      setMotion((current) => current || [context.shot.characterActions, context.shot.cameraMovement].filter(Boolean).join(". "));
    }
  }, [mode, projectId, selectedScene, selectedShot]);

  useEffect(() => {
    void load().catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)));
  }, [load]);

  const hasActiveTake = snapshot.takes.some((take) => activeStatuses.has(take.status));
  useEffect(() => {
    if (!hasActiveTake) return;
    const timer = window.setInterval(() => {
      void load(true).catch(() => undefined);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [hasActiveTake, load]);

  async function action(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/story-creator/video-production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...body }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Video production action failed.");
      await load(true);
      return data;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    } finally {
      setBusy("");
    }
  }

  async function prepareTake() {
    if (!record || !selectedScene || !selectedShot) return;
    const data = await action({
      action: "prepare-take",
      planVersion: record.version,
      sceneId: selectedScene.id,
      shotId: selectedShot.id,
      method,
      motion,
      durationSeconds: duration,
      orientation,
      quality,
      seed: seed ? Number(seed) : undefined,
      rifeInterpolation60Fps: rife,
      referenceVersionIds: selectedReferences,
      userLoras: {
        visualStyle,
        combatMode,
        motionRepair: { enabled: motionRepair, useTrigger: motionRepair },
      },
      h3Settings: {
        renderMode: "turbo",
        checkpointMode: singularity ? "singularity" : "standard",
        combatLoraEnabled: combatMode !== "off",
        refMod: { enabled: false, strength: "balanced" },
        motionLab: { enabled: false },
      },
      idempotencyKey: requestKey("prepare-take"),
    }, "prepare");
    if (data?.take?.id) {
      setPreparedTakeId(data.take.id);
      setNotice("Take prepared. Review the exact request before starting GPU work.");
    }
  }

  const currentTakes = snapshot.takes.filter(
    (take) => take.planVersion === record?.version
      && take.sceneId === selectedScene?.id
      && take.shotId === selectedShot?.id,
  );
  const preparedTake = snapshot.takes.find((take) => take.id === preparedTakeId)
    || [...currentTakes].reverse().find((take) => take.status === "proposed")
    || null;
  const latestBatch = snapshot.batches[0] || null;

  if (!record || record.status !== "approved") {
    return (
      <section className="border-y border-white/10 py-6">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/55">Video Production</p>
        <h2 className="mt-2 text-xl font-black text-white">Approve a production plan first</h2>
        <p className="mt-2 text-sm text-white/55">Planning alone never starts H3 generation.</p>
      </section>
    );
  }

  return (
    <section className="min-w-0 border-y border-white/10 bg-black/20 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/55">H3 Video Production</p>
          <h2 className="mt-2 text-xl font-black text-white">Shots and takes</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
            Prepare, review, and explicitly start MiniMax H3 jobs without leaving this Story.
          </p>
        </div>
        <span className="w-fit rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-black uppercase text-white/50">
          Plan v{record.version} · {mode}
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-white/45">Scene</span>
          <select value={selectedScene?.id || ""} onChange={(event) => { const nextId = event.target.value; const nextScene = scenes.find((scene) => scene.id === nextId); setSceneId(nextId); setShotId(nextScene?.shots[0]?.id || ""); setPreparedTakeId(""); setMotion(""); }} className="min-h-11 w-full rounded-lg border border-white/12 bg-[#0b0d14] px-3 text-sm text-white">
            {scenes.map((scene) => <option key={scene.id} value={scene.id}>Scene {scene.sceneNumber}: {scene.title}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-white/45">Shot</span>
          <select value={selectedShot?.id || ""} onChange={(event) => { setShotId(event.target.value); setPreparedTakeId(""); setMotion(""); }} className="min-h-11 w-full rounded-lg border border-white/12 bg-[#0b0d14] px-3 text-sm text-white">
            {(selectedScene?.shots || []).map((shot) => <option key={shot.id} value={shot.id}>Shot {shot.shotNumber}: {shot.description || "Untitled shot"}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-5 border-y border-white/10 py-4">
        <label className="block">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-white/45">Tell Story Director</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={directorInstruction} onChange={(event) => setDirectorInstruction(event.target.value)} placeholder="Animate Scene 1, Shot 2 with a slow camera move." className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-cyan-200/40" />
            <button type="button" disabled={Boolean(busy) || !directorInstruction.trim()} onClick={async () => {
              const data = await action({ action: "director-action", instruction: directorInstruction, sceneId: selectedScene?.id, shotId: selectedShot?.id, idempotencyKey: requestKey("director-video") }, "director");
              const result = data?.result;
              if (result?.sceneId) setSceneId(result.sceneId);
              if (result?.shotId) setShotId(result.shotId);
              if (result?.take?.id) setPreparedTakeId(result.take.id);
              if (result) setNotice(result.intent === "prepare-batch" ? `${result.takes?.length || 0} shot requests prepared. No GPU work started.` : result.intent === "show-takes" ? `${result.takes?.length || 0} takes found.` : "Story Director prepared a take for your review. No GPU work started.");
            }} className="min-h-11 rounded-lg border border-cyan-200/25 bg-cyan-300/10 px-4 text-sm font-black text-cyan-50 disabled:opacity-40">Prepare Action</button>
          </div>
        </label>
      </div>

      {snapshot.context ? (
        <div className="mt-5 border-l-2 border-cyan-200/30 pl-4">
          <h3 className="text-lg font-black text-white">Shot {snapshot.context.shot.number}</h3>
          <p className="mt-1 text-sm leading-6 text-white/62">{snapshot.context.shot.description || snapshot.context.shot.screenplayExcerpt}</p>
          <p className="mt-2 text-xs text-cyan-100/60">Suggested: {methodLabels[snapshot.context.recommendedMethod]} · {snapshot.context.recommendationReason}</p>
        </div>
      ) : null}

      <label className="mt-5 block">
        <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-white/45">Motion description</span>
        <textarea value={motion} onChange={(event) => setMotion(event.target.value)} rows={4} placeholder="Describe character action and camera movement." className="w-full resize-y rounded-lg border border-white/12 bg-black/40 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-cyan-200/40" />
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label>
          <span className="mb-2 block text-xs font-black uppercase text-white/45">Method</span>
          <select value={method} onChange={(event) => setMethod(event.target.value as StoryVideoMethod)} disabled={mode !== "manual"} className="min-h-11 w-full rounded-lg border border-white/12 bg-[#0b0d14] px-3 text-sm text-white disabled:opacity-60">
            {Object.entries(methodLabels).filter(([value]) => value !== "video-edit").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-2 block text-xs font-black uppercase text-white/45">Duration</span>
          <select value={duration} onChange={(event) => setDuration(Number(event.target.value) === 10 ? 10 : 5)} className="min-h-11 w-full rounded-lg border border-white/12 bg-[#0b0d14] px-3 text-sm text-white"><option value={5}>5 seconds</option><option value={10}>10 seconds</option></select>
        </label>
        <label>
          <span className="mb-2 block text-xs font-black uppercase text-white/45">Orientation</span>
          <select value={orientation} onChange={(event) => setOrientation(event.target.value === "portrait" ? "portrait" : "landscape")} className="min-h-11 w-full rounded-lg border border-white/12 bg-[#0b0d14] px-3 text-sm text-white"><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select>
        </label>
        <label>
          <span className="mb-2 block text-xs font-black uppercase text-white/45">Mode</span>
          <select value={quality} onChange={(event) => setQuality(event.target.value as "sh" | "lq" | "hq")} className="min-h-11 w-full rounded-lg border border-white/12 bg-[#0b0d14] px-3 text-sm text-white"><option value="sh">Scene Hunter</option><option value="lq">LQ</option><option value="hq">HQ</option></select>
        </label>
      </div>

      {snapshot.context?.availableReferences.length ? (
        <fieldset className="mt-5">
          <legend className="text-xs font-black uppercase tracking-[0.12em] text-white/45">Approved references</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {snapshot.context.availableReferences.map((reference) => (
              <label key={reference.versionId} className="flex min-w-0 items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <input type="checkbox" checked={selectedReferences.includes(reference.versionId)} onChange={(event) => setSelectedReferences((current) => event.target.checked ? [...new Set([...current, reference.versionId])] : current.filter((id) => id !== reference.versionId))} className="mt-1" />
                <span className="min-w-0"><strong className="block break-words text-sm text-white">{reference.name}</strong><span className="text-xs text-white/45">{reference.kind.replaceAll("_", " ")} · {reference.bindingType}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <details className="mt-5 border-y border-white/10 py-3">
        <summary className="cursor-pointer text-sm font-black text-white/72">Advanced Settings</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label><span className="mb-2 block text-xs font-black uppercase text-white/45">Seed</span><input value={seed} onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))} placeholder="Random" inputMode="numeric" className="min-h-11 w-full rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white" /></label>
          <label><span className="mb-2 block text-xs font-black uppercase text-white/45">Visual LoRA</span><select value={visualStyle} onChange={(event) => setVisualStyle(event.target.value as typeof visualStyle)} className="min-h-11 w-full rounded-lg border border-white/12 bg-[#0b0d14] px-3 text-sm text-white"><option value="none">None</option><option value="realism">Realism</option><option value="gurren">Gurren</option></select></label>
          <label><span className="mb-2 block text-xs font-black uppercase text-white/45">Combat V2</span><select value={combatMode} onChange={(event) => setCombatMode(event.target.value as typeof combatMode)} className="min-h-11 w-full rounded-lg border border-white/12 bg-[#0b0d14] px-3 text-sm text-white"><option value="off">Off</option><option value="normal">Normal</option><option value="high-action">High action</option><option value="finisher">Finisher</option></select></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-white/65">
          <label className="flex items-center gap-2"><input type="checkbox" checked={singularity} onChange={(event) => setSingularity(event.target.checked)} /> Singularity</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={motionRepair} onChange={(event) => setMotionRepair(event.target.checked)} /> Motion Repair</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={rife} onChange={(event) => setRife(event.target.checked)} /> 60 FPS</label>
        </div>
      </details>

      {error ? <div className="mt-4 rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-2 text-sm text-red-100">{error}</div> : null}
      {notice ? <div className="mt-4 rounded-lg border border-cyan-200/20 bg-cyan-300/[0.07] px-3 py-2 text-sm text-cyan-50/80">{notice}</div> : null}

      <button type="button" disabled={Boolean(busy) || !selectedShot} onClick={() => void prepareTake()} className="mt-5 min-h-11 rounded-lg bg-cyan-300 px-5 py-2 text-sm font-black text-black disabled:opacity-40">
        {busy === "prepare" ? "Preparing..." : "Prepare Video"}
      </button>

      {preparedTake ? (
        <div className="mt-5 rounded-lg border border-amber-200/25 bg-amber-200/[0.06] p-4">
          <div className="text-xs font-black uppercase tracking-[0.12em] text-amber-100/70">Confirmation required</div>
          <h3 className="mt-2 text-lg font-black text-white">Take {preparedTake.takeNumber} · {methodLabels[preparedTake.method]}</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/62">{preparedTake.prompt}</p>
          <div className="mt-3 text-xs text-white/45">{preparedTake.settings.durationSeconds}s · {preparedTake.settings.orientation} · {preparedTake.settings.quality.toUpperCase()} · seed {preparedTake.settings.seed}</div>
          <button type="button" disabled={Boolean(busy)} onClick={async () => { const data = await action({ action: "submit-take", takeId: preparedTake.id, authorized: true }, "submit"); if (data) { setPreparedTakeId(""); setNotice("Video job queued in the shared H3 scheduler."); } }} className="mt-4 min-h-11 rounded-lg bg-emerald-300 px-5 py-2 text-sm font-black text-black disabled:opacity-40">
            {busy === "submit" ? "Queuing..." : "Create Video"}
          </button>
        </div>
      ) : null}

      <div className="mt-7 flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div><h3 className="text-lg font-black text-white">Scene batch</h3><p className="mt-1 text-xs text-white/45">Preparation starts no GPU jobs. Approval is separate and bounded.</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <label><span className="mb-1 block text-[10px] font-black uppercase text-white/40">Maximum jobs</span><input type="number" min={1} max={32} value={batchLimit} onChange={(event) => setBatchLimit(Math.max(1, Math.min(32, Number(event.target.value) || 1)))} className="h-11 w-24 rounded-lg border border-white/12 bg-black/40 px-3 text-sm text-white" /></label>
          <button type="button" disabled={Boolean(busy) || !selectedScene} onClick={async () => { const data = await action({ action: "prepare-batch", sceneIds: selectedScene ? [selectedScene.id] : [], maxJobs: batchLimit, idempotencyKey: requestKey("scene-batch") }, "batch"); if (data) setNotice(`${data.takes?.length || 0} shot requests prepared. No GPU work started.`); }} className="min-h-11 rounded-lg border border-white/12 bg-white/[0.05] px-4 py-2 text-sm font-black text-white disabled:opacity-40">Prepare Scene for Production</button>
        </div>
      </div>

      {latestBatch?.status === "prepared" ? (
        <div className="mt-4 rounded-lg border border-white/12 bg-white/[0.03] p-4">
          <div className="text-sm font-black text-white">Prepared batch · {latestBatch.takeIds.length} shots</div>
          <p className="mt-1 text-xs text-white/45">At most {Math.min(batchLimit, latestBatch.maxJobs)} jobs will be queued by this approval.</p>
          <button type="button" disabled={Boolean(busy)} onClick={async () => { const data = await action({ action: "approve-batch", batchId: latestBatch.id, maxJobs: batchLimit, authorized: true }, "approve-batch"); if (data) setNotice(`${data.submitted?.length || 0} authorized shot jobs queued.`); }} className="mt-3 min-h-11 rounded-lg bg-emerald-300 px-4 py-2 text-sm font-black text-black disabled:opacity-40">Approve Batch and Queue</button>
        </div>
      ) : null}

      <div className="mt-7 border-t border-white/10 pt-5">
        <h3 className="text-lg font-black text-white">Takes for this shot</h3>
        {!currentTakes.length ? <p className="mt-2 text-sm text-white/45">No takes prepared yet.</p> : null}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {currentTakes.map((take) => (
            <article key={take.id} className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-white">Take {take.takeNumber}</strong><span className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-black uppercase text-white/55">{take.status}</span></div>
              <div className="mt-2 text-xs text-white/45">{methodLabels[take.method]} · {take.settings.durationSeconds}s · {take.settings.quality.toUpperCase()} · seed {take.settings.seed}</div>
              {take.previewUrl ? <video controls preload="metadata" src={take.previewUrl} className="mt-3 aspect-video w-full bg-black" /> : null}
              {take.error ? <p className="mt-2 text-xs leading-5 text-red-200">{take.error}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {["completed", "accepted", "rejected"].includes(take.status) ? <button type="button" onClick={() => void action({ action: "accept-take", takeId: take.id }, "decision")} className="min-h-10 rounded-md bg-emerald-300 px-3 text-xs font-black text-black">Keep</button> : null}
                {["completed", "accepted", "rejected"].includes(take.status) ? <button type="button" onClick={() => void action({ action: "reject-take", takeId: take.id }, "decision")} className="min-h-10 rounded-md border border-white/12 px-3 text-xs font-black text-white/65">Reject</button> : null}
                {["completed", "accepted", "rejected", "failed", "canceled"].includes(take.status) ? <button type="button" onClick={async () => { const data = await action({ action: "retry-take", takeId: take.id, motion, idempotencyKey: requestKey("retry") }, "retry"); if (data?.take?.id) { setPreparedTakeId(data.take.id); setNotice("A new take was prepared. The earlier take remains unchanged."); } }} className="min-h-10 rounded-md border border-white/12 px-3 text-xs font-black text-white/65">Try Again</button> : null}
                {take.settings.quality === "sh" && ["completed", "accepted", "rejected"].includes(take.status) ? <button type="button" onClick={async () => { const data = await action({ action: "promote-scene-hunter", takeId: take.id, idempotencyKey: requestKey("promote-sh") }, "promote"); if (data?.take?.id) { setPreparedTakeId(data.take.id); setNotice("HQ promotion prepared with the Scene Hunter seed and request snapshot."); } }} className="min-h-10 rounded-md border border-cyan-200/25 px-3 text-xs font-black text-cyan-50">Prepare HQ</button> : null}
                {["proposed", "queued", "claimed"].includes(take.status) ? <button type="button" onClick={() => void action({ action: "cancel-take", takeId: take.id }, "cancel")} className="min-h-10 rounded-md border border-red-300/20 px-3 text-xs font-black text-red-100">Cancel</button> : null}
                {take.previewUrl ? <a href={`${take.previewUrl}&download=1`} className="inline-flex min-h-10 items-center rounded-md border border-white/12 px-3 text-xs font-black text-white/65">Download</a> : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
