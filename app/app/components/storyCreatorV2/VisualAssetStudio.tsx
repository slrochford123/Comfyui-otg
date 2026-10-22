"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { StoryProductionPlanRecord } from "@/lib/storyCreator/productionPlan";
import type { StoryVisualDirectorAction } from "@/lib/storyCreator/visualActions";

type Entity = { id: string; name: string; entityType: string };
type VisualVersion = {
  id: string;
  version: number;
  kind: string;
  status: string;
  parentVersionId: string | null;
  prompt: string;
  provider: string;
  model: string;
  url: string | null;
  filePath: string | null;
  metadata: Record<string, unknown>;
};
type VisualBinding = {
  id: string;
  versionId: string;
  bindingType: string;
  entityId: string | null;
  planVersion: number | null;
  sceneId: string | null;
  shotId: string | null;
  role: string;
  approved: boolean;
};
type VisualAsset = {
  id: string;
  name: string;
  visualKind: string;
  status: string;
  versions: VisualVersion[];
  bindings: VisualBinding[];
};
type Prepared = {
  asset: { id: string; name: string };
  version: VisualVersion;
  generation: {
    endpoint: string;
    method: string;
    body: Record<string, unknown>;
    requiresExplicitConfirmation: boolean;
  };
};

const kinds = [
  ["character", "Character"], ["villain", "Villain"], ["creature", "Creature"],
  ["location", "Location"], ["object", "Object"], ["vehicle", "Vehicle"],
  ["storyboard", "Storyboard"], ["scene_image", "Scene image"],
  ["shot_reference", "Shot reference"],
] as const;

function errorText(data: unknown, fallback: string) {
  const value = data && typeof data === "object" && "error" in data
    ? (data as { error?: unknown }).error
    : "";
  return typeof value === "string" && value.trim() ? value : fallback;
}

function versionImageUrl(projectId: string, version: VisualVersion) {
  if (version.url) return version.url;
  if (version.filePath) {
    return `/api/story-creator/visual-assets/media?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(version.id)}`;
  }
  return "";
}

export function VisualAssetStudio({
  projectId,
  entities,
  productionPlan,
  productionMode,
  directorAction,
}: {
  projectId: string;
  entities: Entity[];
  productionPlan: StoryProductionPlanRecord | null;
  productionMode: "automatic" | "assisted" | "manual";
  directorAction: StoryVisualDirectorAction | null;
}) {
  const [assets, setAssets] = useState<VisualAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [directorInstruction, setDirectorInstruction] = useState("");
  const [visualKind, setVisualKind] = useState("character");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [artStyle, setArtStyle] = useState("cinematic production reference, consistent identity, detailed");
  const [aspectRatio, setAspectRatio] = useState("landscape");
  const [entityId, setEntityId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [shotId, setShotId] = useState("");
  const [editingAssetId, setEditingAssetId] = useState("");
  const [sourceVersionId, setSourceVersionId] = useState("");
  const [referenceVersionIds, setReferenceVersionIds] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [compareAssetId, setCompareAssetId] = useState("");

  const scenes = useMemo(
    () => productionPlan?.plan.acts.flatMap((act) => act.scenes) || [],
    [productionPlan],
  );
  const selectedScene = scenes.find((scene) => scene.id === sceneId) || null;

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/story-creator/visual-assets?projectId=${encodeURIComponent(projectId)}`, {
        cache: "no-store", credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(data, "Could not load visual assets."));
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load visual assets.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setPrepared(null);
    setEditingAssetId("");
    setSourceVersionId("");
  }, [projectId]);
  useEffect(() => {
    if (!directorAction || directorAction.action === "show-versions") return;
    setVisualKind(directorAction.visualKind || "scene_image");
    setName(directorAction.name || "Story visual");
    setPrompt(directorAction.prompt);
    setEntityId(directorAction.entityId || "");
    setEditingAssetId(directorAction.assetId || "");
    setSourceVersionId(directorAction.sourceVersionId || "");
    setReferenceVersionIds(directorAction.referenceVersionIds || []);
    setSceneId(directorAction.sceneId || "");
    setShotId(directorAction.shotId || "");
    setPrepared(null);
    setError("");
    setNotice("Story Director handed off this Qwen action. Review it, then choose Prepare Image.");
  }, [directorAction]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/story-creator/visual-assets", {
      method: "POST", cache: "no-store", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorText(data, "Visual asset action failed."));
    return data;
  }

  function resetDraft() {
    setPrepared(null);
    setEditingAssetId("");
    setSourceVersionId("");
    setReferenceVersionIds([]);
  }

  async function prepare() {
    if (!name.trim() || !prompt.trim() || busy) {
      setError("Add an asset name and visual description first.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await post({
        action: sourceVersionId ? "prepare-edit" : "prepare-generation",
        assetId: editingAssetId || undefined,
        sourceVersionId: sourceVersionId || undefined,
        visualKind, name: name.trim(), prompt: prompt.trim(), artStyle,
        aspectRatio, referenceVersionIds, entityId: entityId || undefined,
        metadata: {
          planVersion: productionPlan?.version || null,
          sceneId: sceneId || null,
          shotId: shotId || null,
        },
      });
      setPrepared(data as Prepared);
      setNotice("Prepared and saved. Review the contract before starting Qwen.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare visual asset.");
    } finally { setBusy(false); }
  }

  async function createImage() {
    if (!prepared || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      let response: Response;
      const primaryReferenceId = prepared.version.parentVersionId ||
        (Array.isArray(prepared.version.metadata.referenceVersionIds)
          ? String(prepared.version.metadata.referenceVersionIds[0] || "")
          : "");
      if (primaryReferenceId) {
        const sourceVersion = assets
          .flatMap((asset) => asset.versions)
          .find((version) => version.id === primaryReferenceId);
        const sourceUrl = sourceVersion ? versionImageUrl(projectId, sourceVersion) : "";
        if (!sourceUrl) throw new Error("The selected source version has no available image.");
        const sourceResponse = await fetch(sourceUrl, { credentials: "include", cache: "no-store" });
        if (!sourceResponse.ok) throw new Error("Could not load the source image for editing.");
        const blob = await sourceResponse.blob();
        const form = new FormData();
        form.set("workflowId", "presets/image_qwen_image_2_1_image_edit");
        form.set("requestKind", "generate-qwen21-image-edit");
        form.set("sourceType", "story-visual-asset-edit");
        form.set("prompt", prepared.version.prompt);
        form.set("positivePrompt", prepared.version.prompt);
        form.set("negativePrompt", "");
        form.set("orientation", String(prepared.version.metadata.aspectRatio || "landscape"));
        form.set("seed", String(Math.floor(Math.random() * 2_000_000_000)));
        form.set("imageA", new File([blob], "story-source.png", { type: blob.type || "image/png" }));
        response = await fetch("/api/comfy", { method: "POST", credentials: "include", body: form });
      } else {
        response = await fetch(prepared.generation.endpoint, {
          method: "POST", cache: "no-store", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(prepared.generation.body),
        });
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(result, "Qwen submission failed."));
      const promptId = String(result.promptId || result.prompt_id || "").trim();
      if (!promptId) throw new Error("Qwen accepted the request without returning a prompt id.");
      await post({
        action: "record-submission",
        versionId: prepared.version.id,
        promptId,
        response: result,
        endpoint: primaryReferenceId ? "/api/comfy" : prepared.generation.endpoint,
      });
      setNotice(`Qwen job ${promptId} submitted after explicit confirmation.`);
      resetDraft();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not submit Qwen job.");
    } finally { setBusy(false); }
  }

  async function interpretDirectorInstruction() {
    if (!directorInstruction.trim() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/story-creator/visual-actions", {
        method: "POST", cache: "no-store", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, instruction: directorInstruction }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(data, "Story Director could not prepare that action."));
      const action = data.action || {};
      if (action.action === "show-versions") {
        setCompareAssetId(String(action.assetId || ""));
        setNotice("Showing the matching visual version history.");
      } else {
        setVisualKind(String(action.visualKind || "scene_image"));
        setName(String(action.name || "Story visual"));
        setPrompt(String(action.prompt || directorInstruction));
        setEntityId(String(action.entityId || ""));
        setEditingAssetId(String(action.assetId || ""));
        setSourceVersionId(String(action.sourceVersionId || ""));
        setReferenceVersionIds(Array.isArray(action.referenceVersionIds) ? action.referenceVersionIds : []);
        setSceneId(String(action.sceneId || ""));
        setShotId(String(action.shotId || ""));
        setPrepared(null);
        setNotice("Story Director prepared a draft. Review it, then choose Prepare.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Story Director action failed.");
    } finally { setBusy(false); }
  }

  async function planFromProduction() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await post({ action: "plan-from-production" });
      setNotice(`Prepared ${Number(data.result?.created || 0)} visual records and reused ${Number(data.result?.reused || 0)}. No GPU jobs were started.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not plan production visuals.");
    } finally { setBusy(false); }
  }

  async function upload(file: File | null) {
    if (!file || !name.trim() || busy) {
      if (!name.trim()) setError("Name the visual before attaching an image.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const form = new FormData();
      form.set("projectId", projectId); form.set("visualKind", visualKind);
      form.set("name", name.trim()); form.set("prompt", prompt.trim()); form.set("image", file, file.name);
      if (editingAssetId) form.set("assetId", editingAssetId);
      const response = await fetch("/api/story-creator/visual-assets/upload", {
        method: "POST", credentials: "include", body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(data, "Could not attach image."));
      setNotice("Image attached as a new preserved version."); resetDraft(); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not attach image.");
    } finally { setBusy(false); }
  }

  async function versionAction(action: "approve-version" | "reject-version" | "restore-version", versionId: string) {
    setBusy(true); setError("");
    try {
      await post({ action, versionId });
      setNotice(action === "approve-version" ? "Version approved for future Story Director use." : action === "reject-version" ? "Version rejected; earlier versions remain available." : "Earlier image restored as a new version.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Version action failed."); }
    finally { setBusy(false); }
  }

  async function bind(versionId: string) {
    const bindingType = shotId ? "shot" : sceneId ? "scene" : entityId ? "entity" : "project";
    setBusy(true); setError("");
    try {
      await post({
        action: "bind-version", versionId, bindingType, entityId: entityId || undefined,
        planVersion: productionPlan?.version || undefined, sceneId: sceneId || undefined,
        shotId: shotId || undefined, role: shotId ? "keyframe" : sceneId ? "storyboard" : "identity",
      });
      setNotice("Visual linked to the selected Story production target."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not link visual."); }
    finally { setBusy(false); }
  }

  return (
    <section className="rounded-[20px] border border-cyan-300/15 bg-cyan-300/[0.035] p-4 xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/55">Visual Assets</p><h3 className="mt-2 text-lg font-black text-white">Qwen 2.1 Turbo Visual Asset Studio</h3></div>
        <div className="flex flex-wrap gap-2"><span className="rounded-[10px] border border-white/10 px-3 py-2 text-xs text-white/55">{productionMode} mode</span><span className="rounded-[10px] border border-white/10 px-3 py-2 text-xs text-white/55">{assets.length} persistent assets</span></div>
      </div>

      {productionMode === "automatic" ? <button type="button" disabled={busy || productionPlan?.status !== "approved"} onClick={() => void planFromProduction()} className="mt-3 rounded-[12px] border border-emerald-300/25 bg-emerald-300/10 px-4 py-2.5 text-sm font-black text-emerald-50 disabled:opacity-40">Plan Required Visuals</button> : null}

      <div className="mt-4 rounded-[14px] border border-white/10 bg-black/25 p-3">
        <label className="block text-xs font-black uppercase tracking-[0.12em] text-white/45">Tell Story Director</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input value={directorInstruction} onChange={(event) => setDirectorInstruction(event.target.value)} placeholder="Create an image for Shot 2" className="min-w-0 flex-1 rounded-[12px] border border-white/10 bg-black/45 px-3 py-2.5 text-sm text-white outline-none" />
          <button type="button" disabled={busy || !directorInstruction.trim()} onClick={() => void interpretDirectorInstruction()} className="rounded-[12px] border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-black text-cyan-50 disabled:opacity-40">Prepare Action</button>
        </div>
      </div>

      <details className="mt-3 rounded-[14px] border border-white/10 bg-black/20" open>
        <summary className="cursor-pointer px-4 py-3 text-sm font-black text-white">Create or edit a visual</summary>
        <div className="grid gap-3 border-t border-white/10 p-4 md:grid-cols-2">
          <label className="text-xs text-white/55">Type<select value={visualKind} onChange={(event) => { setVisualKind(event.target.value); setPrepared(null); }} className="mt-1 w-full rounded-[12px] border border-white/10 bg-black px-3 py-2.5 text-sm text-white">{kinds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label className="text-xs text-white/55">Name<input value={name} onChange={(event) => { setName(event.target.value); setPrepared(null); }} className="mt-1 w-full rounded-[12px] border border-white/10 bg-black/45 px-3 py-2.5 text-sm text-white" /></label>
          <label className="text-xs text-white/55 md:col-span-2">Visual description<textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); setPrepared(null); }} rows={4} className="mt-1 w-full resize-y rounded-[12px] border border-white/10 bg-black/45 px-3 py-2.5 text-sm leading-6 text-white" /></label>
          <label className="text-xs text-white/55">Style<input value={artStyle} onChange={(event) => { setArtStyle(event.target.value); setPrepared(null); }} className="mt-1 w-full rounded-[12px] border border-white/10 bg-black/45 px-3 py-2.5 text-sm text-white" /></label>
          <label className="text-xs text-white/55">Aspect ratio<select value={aspectRatio} onChange={(event) => { setAspectRatio(event.target.value); setPrepared(null); }} className="mt-1 w-full rounded-[12px] border border-white/10 bg-black px-3 py-2.5 text-sm text-white"><option value="landscape">Landscape</option><option value="portrait">Portrait</option><option value="square">Square</option></select></label>
          <label className="text-xs text-white/55">Story entity<select value={entityId} onChange={(event) => setEntityId(event.target.value)} className="mt-1 w-full rounded-[12px] border border-white/10 bg-black px-3 py-2.5 text-sm text-white"><option value="">Project only</option>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
          <label className="text-xs text-white/55">Scene<select value={sceneId} onChange={(event) => { setSceneId(event.target.value); setShotId(""); }} className="mt-1 w-full rounded-[12px] border border-white/10 bg-black px-3 py-2.5 text-sm text-white"><option value="">No scene</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>Scene {scene.sceneNumber}: {scene.title}</option>)}</select></label>
          <label className="text-xs text-white/55">Shot<select value={shotId} disabled={!selectedScene} onChange={(event) => setShotId(event.target.value)} className="mt-1 w-full rounded-[12px] border border-white/10 bg-black px-3 py-2.5 text-sm text-white disabled:opacity-40"><option value="">No shot</option>{selectedScene?.shots.map((shot) => <option key={shot.id} value={shot.id}>Shot {shot.shotNumber}: {shot.description}</option>)}</select></label>
          <label className="text-xs text-white/55">Attach existing image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0] || null); event.currentTarget.value = ""; }} className="mt-1 block w-full text-xs text-white/55 file:mr-3 file:rounded-[10px] file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-white" /></label>
          <div className="flex flex-wrap items-end gap-2 md:col-span-2">
            <button type="button" disabled={busy} onClick={() => void prepare()} className="rounded-[12px] bg-cyan-300 px-4 py-2.5 text-sm font-black text-black disabled:opacity-40">{busy ? "Working..." : sourceVersionId ? "Prepare Edit" : "Prepare Image"}</button>
            {(editingAssetId || sourceVersionId) ? <button type="button" onClick={resetDraft} className="rounded-[12px] border border-white/10 px-4 py-2.5 text-sm font-black text-white/65">Cancel Edit</button> : null}
          </div>
        </div>
      </details>

      {prepared ? <div className="mt-3 rounded-[14px] border border-amber-300/25 bg-amber-300/[0.06] p-4"><div className="text-xs font-black uppercase tracking-[0.12em] text-amber-100/65">Confirmation required</div><div className="mt-2 text-sm font-black text-white">{prepared.asset.name} · version {prepared.version.version}</div><p className="mt-2 text-sm leading-6 text-white/65">{prepared.version.prompt}</p><div className="mt-2 text-xs text-white/45">{prepared.version.provider === "qwen-image-edit-2-1" ? "Qwen Image Edit 2.1 Turbo" : "Qwen Image 2.1 Turbo"} · 8 steps · CFG 1 · RTX 5060 Ti · {String(prepared.version.metadata.aspectRatio || "landscape")} · {referenceVersionIds.length} selected references</div><button type="button" disabled={busy} onClick={() => void createImage()} className="mt-3 rounded-[12px] bg-amber-300 px-4 py-2.5 text-sm font-black text-black disabled:opacity-40">Create Image</button></div> : null}
      {error ? <div className="mt-3 rounded-[12px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</div> : null}
      {notice ? <div className="mt-3 rounded-[12px] border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-2 text-sm text-cyan-50/75">{notice}</div> : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {loading ? <div className="text-sm text-white/45">Loading visual library...</div> : null}
        {!loading && !assets.length ? <div className="rounded-[14px] border border-dashed border-white/10 p-5 text-sm text-white/45">No Phase 5 visuals yet. Prepare one or attach an existing image.</div> : null}
        {assets.map((asset) => {
          const current = asset.versions.find((version) => version.status === "approved") || asset.versions[0];
          const showAll = compareAssetId === asset.id;
          const shownVersions = showAll ? asset.versions : current ? [current] : [];
          return <article key={asset.id} className="rounded-[14px] border border-white/10 bg-black/25 p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-sm font-black text-white">{asset.name}</div><div className="mt-1 text-xs text-white/45">{asset.visualKind} · {asset.versions.length} version{asset.versions.length === 1 ? "" : "s"}</div></div><span className="rounded-[9px] border border-white/10 px-2 py-1 text-[10px] font-black uppercase text-white/55">{current?.status || asset.status}</span></div><div className={showAll ? "mt-3 grid grid-cols-2 gap-2" : "mt-3"}>{shownVersions.map((version) => { const imageUrl = versionImageUrl(projectId, version); return <div key={version.id} className="rounded-[12px] border border-white/10 bg-black/35 p-2">{imageUrl ? <Image src={imageUrl} alt={`${asset.name} version ${version.version}`} width={480} height={320} unoptimized className="aspect-[4/3] w-full rounded-[9px] object-cover" /> : <div className="flex aspect-[4/3] items-center justify-center rounded-[9px] bg-black/40 text-xs text-white/40">{version.status}</div>}<div className="mt-2 text-xs text-white/50">Version {version.version} · {version.status}</div><div className="mt-2 flex flex-wrap gap-1.5">{version.status === "ready" ? <button type="button" disabled={busy} onClick={() => void versionAction("approve-version", version.id)} className="rounded-[9px] bg-emerald-300 px-2.5 py-1.5 text-xs font-black text-black">Keep</button> : null}{imageUrl ? <button type="button" disabled={busy} onClick={() => { setEditingAssetId(asset.id); setSourceVersionId(version.id); setVisualKind(asset.visualKind); setName(asset.name); setPrompt(""); setPrepared(null); }} className="rounded-[9px] border border-white/10 px-2.5 py-1.5 text-xs font-black text-white/65">Edit</button> : null}<button type="button" disabled={busy} onClick={() => { setEditingAssetId(asset.id); setSourceVersionId(""); setVisualKind(asset.visualKind); setName(asset.name); setPrompt(version.prompt); setPrepared(null); }} className="rounded-[9px] border border-white/10 px-2.5 py-1.5 text-xs font-black text-white/65">Try Again</button>{imageUrl ? <button type="button" disabled={busy} onClick={() => void versionAction("restore-version", version.id)} className="rounded-[9px] border border-white/10 px-2.5 py-1.5 text-xs font-black text-white/65">Restore</button> : null}{version.status === "ready" ? <button type="button" disabled={busy} onClick={() => void versionAction("reject-version", version.id)} className="rounded-[9px] border border-red-300/20 px-2.5 py-1.5 text-xs font-black text-red-100/70">Reject</button> : null}{(version.status === "approved" || version.status === "ready") ? <button type="button" disabled={busy} onClick={() => void bind(version.id)} className="rounded-[9px] border border-cyan-300/20 px-2.5 py-1.5 text-xs font-black text-cyan-50/70">Attach</button> : null}</div></div>; })}</div><button type="button" onClick={() => setCompareAssetId(showAll ? "" : asset.id)} className="mt-3 text-xs font-black text-cyan-100/65">{showAll ? "Close comparison" : "Compare versions"}</button>{asset.bindings.length ? <div className="mt-2 text-xs text-white/40">Linked to {asset.bindings.length} Story target{asset.bindings.length === 1 ? "" : "s"}</div> : null}</article>;
        })}
      </div>
    </section>
  );
}
