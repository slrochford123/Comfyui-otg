"use client";

import Image from "next/image";
import ImageEditEngineSelect from "../ImageEditEngineSelect";
import {submitNativeImageEdit, type NativeEditEngine} from "@/lib/client/nativeImages";
import { useCallback, useEffect, useState } from "react";
import type { StoryVisualDirectorAction } from "@/lib/storyCreator/visualActions";

type VisualVersion = { id: string; assetId: string; jobId: string | null; status: string; parentVersionId: string | null; prompt: string; url: string | null; filePath: string | null; metadata: Record<string, unknown> };
type Prepared = { asset: { id: string; name: string }; version: VisualVersion; generation: { endpoint: string; body: Record<string, unknown> } };

function message(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

export function StoryDirectorVisualCard({ projectId, action, onChange }: {
  projectId: string;
  action: StoryVisualDirectorAction;
  onChange: (draft: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editEngine, setEditEngine] = useState<NativeEditEngine>("qwen");
  const [version, setVersion] = useState<VisualVersion | null>(null);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/story-creator/visual-assets", {
      method: "POST", cache: "no-store", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(message(data, "Visual action failed."));
    return data;
  }

  const loadVersion = useCallback(async (versionId: string) => {
    const response = await fetch(`/api/story-creator/visual-assets?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store", credentials: "include" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return null;
    for (const asset of Array.isArray(data.assets) ? data.assets : []) {
      const found = Array.isArray(asset.versions) ? asset.versions.find((item: VisualVersion) => item.id === versionId) : null;
      if (found) { setVersion(found); return found as VisualVersion; }
    }
    return null;
  }, [projectId]);

  useEffect(() => {
    if (!version && action.displayVersionId) void loadVersion(action.displayVersionId);
  }, [action.displayVersionId, loadVersion, version]);

  const finalizeVersion = useCallback(async (current: Pick<VisualVersion, "id" | "assetId" | "jobId">) => {
    if (!current.jobId) return loadVersion(current.id);
    const response = await fetch("/api/story-creator/assets/status", {
      method: "POST", cache: "no-store", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, assetId: current.assetId, jobId: current.jobId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(message(data, "Could not check image creation status."));
    return loadVersion(current.id);
  }, [loadVersion, projectId]);

  useEffect(() => {
    if (!version?.id || !["planned", "prepared", "submitted", "generating"].includes(version.status)) return;
    const current = { id: version.id, assetId: version.assetId, jobId: version.jobId };
    let active = true;
    const refresh = async () => {
      try {
        await finalizeVersion(current);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Could not check image creation status.");
      }
    };
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [finalizeVersion, version?.assetId, version?.id, version?.jobId, version?.status]);

  async function create() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const prepared = await post({
        action: action.action === "prepare-edit" ? "prepare-edit" : "prepare-generation",
        assetId: action.assetId || undefined,
        sourceVersionId: action.sourceVersionId || undefined,
        visualKind: action.visualKind,
        name: action.name,
        prompt: action.prompt,
        artStyle: "story-directed visual design",
        aspectRatio: "landscape",
        referenceVersionIds: action.referenceVersionIds,
        editEngine,
        entityId: action.entityId || undefined,
        metadata: { planVersion: action.planVersion, sceneId: action.sceneId, shotId: action.shotId, source: "story-director-conversation" },
      }) as Prepared;
      setVersion(prepared.version);
      let response: Response;
      if (action.action === "prepare-edit" && action.sourceVersionId) {
        const sourceResponse = await fetch(`/api/story-creator/visual-assets/media?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(action.sourceVersionId)}`, { cache: "no-store", credentials: "include" });
        if (!sourceResponse.ok) throw new Error("Could not load the approved source image for editing.");
        const blob = await sourceResponse.blob();
        if (editEngine !== "qwen") {
          const result = await submitNativeImageEdit({model: editEngine, image: new File([blob], "story-source.png", {type: blob.type || "image/png"}),
            prompt: prepared.version.prompt, seed: String(Math.floor(Math.random() * 2 ** 32))});
          const submitted = await post({action: "record-submission", versionId: prepared.version.id, promptId: result.promptId, response: result, endpoint: "/api/images/native"});
          setVersion(submitted.version); setNotice("Image edit started with the selected Fibo model. Earlier versions are preserved."); return;
        }
        const form = new FormData();
        form.set("workflowId", "presets/image_qwen_image_2_1_image_edit");
        form.set("requestKind", "generate-qwen21-image-edit");
        form.set("sourceType", "story-visual-asset-edit");
        form.set("prompt", prepared.version.prompt);
        form.set("positivePrompt", prepared.version.prompt);
        form.set("negativePrompt", "");
        form.set("orientation", "landscape");
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
      if (!response.ok) throw new Error(message(result, "Qwen submission failed."));
      const promptId = String(result.promptId || result.prompt_id || "").trim();
      if (!promptId) throw new Error("Qwen accepted the request without a job id.");
      const submitted = await post({ action: "record-submission", versionId: prepared.version.id, promptId, response: result, endpoint: action.action === "prepare-edit" ? "/api/comfy" : prepared.generation.endpoint });
      setVersion(submitted.version);
      setNotice("Image creation started. It will appear here when ready.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the image.");
    } finally { setBusy(false); }
  }

  async function approve() {
    if (!version || busy) return;
    setBusy(true); setError("");
    try {
      await post({ action: "approve-version", versionId: version.id });
      if (action.entityId) await post({ action: "bind-version", versionId: version.id, bindingType: "entity", entityId: action.entityId, role: "identity" });
      await loadVersion(version.id);
      setNotice("Approved as the current visual reference. Earlier versions remain available.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not approve the image."); }
    finally { setBusy(false); }
  }

  const imageUrl = version && (version.url || version.filePath)
    ? `/api/story-creator/visual-assets/media?projectId=${encodeURIComponent(projectId)}&versionId=${encodeURIComponent(version.id)}`
    : "";
  return <section className="mx-4 mb-4 rounded-[16px] border border-cyan-300/30 bg-cyan-300/[0.08] p-4">
    <p className="text-xs font-black uppercase tracking-[0.12em] text-cyan-100/65">Visual design</p>
    <h3 className="mt-2 text-base font-black text-white">{action.name}</h3>
    <p className="mt-2 text-sm leading-6 text-white/65">{action.prompt}</p>
    {action.action === "prepare-edit" ? <ImageEditEngineSelect value={editEngine} onChange={setEditEngine} disabled={busy || Boolean(version)} referenceCount={new Set([action.sourceVersionId, ...(action.referenceVersionIds || [])].filter(Boolean)).size} /> : null}
    {imageUrl ? <Image src={imageUrl} alt={action.name} width={768} height={512} unoptimized className="mt-3 max-h-[520px] w-full rounded-[12px] object-contain" /> : null}
    {version && !imageUrl ? <div className="mt-3 rounded-[12px] border border-white/10 p-3 text-sm text-white/55">{version.status === "failed" ? "Image creation failed." : "Creating image..."}</div> : null}
    {error ? <div className="mt-3 rounded-[10px] border border-red-300/20 bg-red-500/10 p-2 text-xs text-red-100">{error}</div> : null}
    {notice ? <div className="mt-3 text-xs text-cyan-50/70">{notice}</div> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      {!version ? <button type="button" disabled={busy} onClick={() => void create()} className="min-h-11 rounded-[12px] bg-cyan-300 px-4 py-2 text-sm font-black text-black disabled:opacity-40">{busy ? "Starting..." : action.action === "prepare-edit" ? "Change Image" : "Create Image"}</button> : null}
      {imageUrl && version?.status !== "approved" ? <button type="button" disabled={busy} onClick={() => void approve()} className="min-h-11 rounded-[12px] bg-emerald-300 px-4 py-2 text-sm font-black text-black disabled:opacity-40">Approve</button> : null}
      {imageUrl ? <button type="button" onClick={() => onChange(`Change ${action.name}: `)} className="min-h-11 rounded-[12px] border border-white/15 px-4 py-2 text-sm font-black text-white">Change</button> : null}
    </div>
  </section>;
}
