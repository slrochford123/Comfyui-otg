"use client";

import React, { useEffect, useMemo, useState, type ReactNode } from "react";

import { buildProductionPrompt } from "@/lib/production/promptBuilder";
import {
  H3_COMBAT_LORA_MODES,
  H3_VISUAL_STYLE_LORA_OPTIONS,
  type ProductionV2H3CombatLoraMode,
  type ProductionV2H3UserLoraState,
  type ProductionV2H3VisualStyleLora,
} from "@/lib/production/h3Loras";
import {
  H3_CAMERA_FEEL_OPTIONS,
  H3_SHOT_FLOW_OPTIONS,
  H3_VISUAL_STYLE_OPTIONS,
  type ProductionV2PromptOptions,
} from "@/lib/production/promptOptions";
import {
  LTX_V2_DEFAULT_INGREDIENT_LIMIT,
  PRODUCTION_V2_DURATION_OPTIONS,
  PRODUCTION_V2_H3_MAX_SPEAKERS,
  PRODUCTION_V2_MAX_SCENES,
  addProductionV2Scene,
  buildProductionV2ScenePrompt,
  createProductionV2DialogueTurn,
  invalidateProductionV2Prompts,
  markProductionV2SceneSaved,
  moveProductionV2AssemblyClip,
  productionV2DialogueDurationWarning,
  productionV2GenerationReadiness,
  productionV2LtxVisualIngredientCount,
  productionV2ModesForModel,
  productionV2SavedScenes,
  productionV2SceneCardStatus,
  productionV2SpeakingCharacters,
  reviewProductionV2FinalPrompt,
  selectProductionV2AssemblyClipVersion,
  selectProductionV2SceneMediaVersion,
  switchProductionV2SceneMode,
  switchProductionV2SceneModel,
  syncProductionV2AssemblyClips,
  syncProductionV2ReferencePlan,
  updateProductionV2ScenePrompt,
  updateProductionV2ScenePromptText,
  type ProductionV2,
  type ProductionV2AssetSelection,
  type ProductionV2AssemblyState,
  type ProductionV2BackgroundSelection,
  type ProductionV2CatalogAsset,
  type ProductionV2CatalogBackground,
  type ProductionV2CatalogCharacter,
  type ProductionV2CatalogPerspective,
  type ProductionV2CharacterSelection,
  type ProductionV2DialogueTurn,
  type ProductionV2Duration,
  type ProductionV2EntityImage,
  type ProductionV2GenerationMode,
  type ProductionV2Model,
  type ProductionV2ReferencePlan,
  type ProductionV2Scene,
  type ProductionV2SceneMediaVersion,
  type ProductionV2Stage,
  type ProductionV2Summary,
  type ProductionV2VisualReference,
} from "@/lib/production/v2";

type HomeView = "actions" | "create" | "load" | "delete" | "completed";

type ReferenceCatalogPayload = {
  ok: boolean;
  characters?: ProductionV2CatalogCharacter[];
  backgrounds?: ProductionV2CatalogBackground[];
  assets?: ProductionV2CatalogAsset[];
  error?: string;
};

type ProductionV2ListPayload = {
  ok: boolean;
  drafts?: ProductionV2Summary[];
  completed?: ProductionV2Summary[];
  activeProduction?: ProductionV2 | null;
  error?: string;
};

type PromptBuildPayload = {
  ok: boolean;
  provider: string;
  repaired: boolean;
  builderId: string;
  lockedReferenceContext: string;
  scenePrompt: string;
  finalPrompt: string;
  referencePlan: ProductionV2ReferencePlan;
  error?: string;
};

type ProductionV2GenerationJobPayload = {
  id: string;
  status:
    | "pending"
    | "queued_waiting_for_gpu"
    | "claimed"
    | "submitted"
    | "running"
    | "postprocessing_waiting_for_gpu"
    | "postprocessing_submitted"
    | "postprocessing_running"
    | "completed"
    | "failed";
  statusMessage: string | null;
  backend: "rtx3090" | "rtx5060ti" | null;
  backendLabel: string | null;
  promptId: string | null;
  workflowId: string | null;
  operation?: "scene-generation" | "visual-edit";
  retryOfJobId?: string | null;
  error: string | null;
  videoUrl: string | null;
};

const MODEL_LABELS: Record<ProductionV2Model, string> = {
  "minimax-h3": "MiniMax H3",
  "ltx-2.5": "LTX 2.5",
};

const MODE_LABELS: Record<ProductionV2GenerationMode, string> = {
  "h3-image-to-video": "Image-to-Video",
  "h3-reference-to-video": "Reference-to-Video",
  "ltx-ingredients-image-to-video": "Ingredients Image-to-Video",
};

const COMPACT_MODE_LABELS: Record<ProductionV2GenerationMode, string> = {
  "h3-image-to-video": "I2V",
  "h3-reference-to-video": "R2V",
  "ltx-ingredients-image-to-video": "Ingredients I2V",
};

const STAGE_LABELS: Record<ProductionV2Stage, string> = {
  storyboard: "Storyboard",
  "visual-studios": "Visual Studios",
  "audio-studios": "Audio Studios",
  assembly: "Assembly",
};

const REVIEW_LABELS = {
  idle: "Not built",
  "needs-review": "Needs review",
  reviewed: "Reviewed",
  stale: "Stale - rebuild required",
  error: "Build error",
} as const;

const H3_VISUAL_STYLE_LORA_LABELS: Record<ProductionV2H3VisualStyleLora, string> = {
  none: "None",
  realism: "Realism",
  gurren: "Gurren",
};

const H3_COMBAT_LORA_LABELS: Record<ProductionV2H3CombatLoraMode, string> = {
  off: "Off",
  normal: "Normal (no trigger)",
  "high-action": "High action (prfight2)",
  finisher: "Finisher (prfight2, prfin1)",
};

const ACTIVE_PRODUCTION_V2_GENERATION_STATUSES = new Set<ProductionV2GenerationJobPayload["status"]>([
  "pending",
  "queued_waiting_for_gpu",
  "claimed",
  "submitted",
  "running",
  "postprocessing_waiting_for_gpu",
  "postprocessing_submitted",
  "postprocessing_running",
]);

function productionV2GenerationIsActive(status: ProductionV2GenerationJobPayload["status"] | undefined) {
  return Boolean(status && ACTIVE_PRODUCTION_V2_GENERATION_STATUSES.has(status));
}

const buttonBase = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-45";
const primaryButton = `${buttonBase} border-cyan-300/35 bg-cyan-300 text-zinc-950 hover:bg-cyan-200`;
const productionPrimaryButton = `${buttonBase} production-v2-primary-action`;
const secondaryButton = `${buttonBase} border-white/15 bg-white/[0.06] text-zinc-100 hover:bg-white/[0.1]`;
const dangerButton = `${buttonBase} border-red-300/35 bg-red-400/15 text-red-100 hover:bg-red-400/25`;
const fieldClass = "w-full rounded-lg border border-white/12 bg-black/35 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-cyan-300/60";
const EMPTY_EXPANDED_GROUPS = new Set<string>();

function mediaUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^(https?:|blob:|data:)/i.test(text) || text.startsWith("/api/") || text.startsWith("/characters/")) return text;
  if (text.startsWith("/")) return `/api/file?path=${encodeURIComponent(text)}`;
  return text;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null) as T | null;
  if (!response.ok) throw new Error(String((json as { error?: string } | null)?.error || `Request failed (${response.status})`));
  if (!json) throw new Error("The server returned an empty response.");
  return json;
}

function HomeAction({ title, subtitle, onClick, accent }: { title: string; subtitle: string; onClick: () => void; accent: string }) {
  return (
    <button type="button" onClick={onClick} className="group min-h-36 rounded-lg border border-white/10 bg-zinc-950/70 p-5 text-left shadow-lg transition hover:-translate-y-0.5 hover:border-white/25 hover:bg-zinc-900">
      <span className={`block h-1.5 w-12 rounded-full ${accent}`} />
      <span className="mt-5 block text-lg font-black text-white">{title}</span>
      <span className="mt-2 block text-sm leading-6 text-zinc-400">{subtitle}</span>
    </button>
  );
}

function SummaryRow({ item, actionLabel, onAction, destructive = false }: { item: ProductionV2Summary; actionLabel: string; onAction: () => void; destructive?: boolean }) {
  return (
    <div className="flex flex-col gap-3 border-b border-white/10 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="break-words font-black text-white">{item.name}</div>
        <div className="mt-1 text-xs text-zinc-500">{item.sceneCount} scene{item.sceneCount === 1 ? "" : "s"} | {MODEL_LABELS[item.defaultModel]} | {formatUpdatedAt(item.updatedAt)}</div>
      </div>
      <button type="button" onClick={onAction} className={destructive ? dangerButton : secondaryButton}>{actionLabel}</button>
    </div>
  );
}

function SegmentButton({ active, children, onClick, disabled = false }: { active: boolean; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${active ? "production-v2-control-active" : "border-white/10 bg-black/25 text-zinc-400 hover:border-white/25 hover:text-white"}`}>
      {children}
    </button>
  );
}

function NumberedHeading({ number, title, description }: { number: string; title: string; description?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="production-v2-heading-index flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-black">{number}</span>
      <div className="min-w-0">
        <h2 className="text-lg font-black text-white">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p> : null}
      </div>
    </div>
  );
}

function SelectControl({ label, value, options, onChange, disabled }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <label className="block text-xs font-black uppercase text-zinc-500">
      {label}
      <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${fieldClass} mt-2 normal-case`}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function ReferenceAccordion({ label, count, expanded, onToggle, children }: { label: string; count: number; expanded: boolean; onToggle: () => void; children: ReactNode }) {
  const regionId = `production-v2-${label.toLowerCase()}-references`;
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-black/20" data-otg={`production-v2-${label.toLowerCase()}-accordion`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={regionId} className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04]">
        <span className="font-black uppercase text-zinc-200">{label}</span>
        <span className="rounded bg-white/[0.06] px-2 py-0.5 text-xs font-bold text-zinc-500">{count}</span>
        <span aria-hidden="true" className="ml-auto text-sm font-black text-zinc-500">{expanded ? "v" : ">"}</span>
      </button>
      <div id={regionId} hidden={!expanded} className="border-t border-white/10 p-3 sm:p-4">{children}</div>
    </section>
  );
}

function EntityCard({
  entityType,
  entityId,
  name,
  image,
  imageLabel,
  perspectives,
  selected,
  expanded,
  onSelect,
  onTogglePerspectives,
  disabled = false,
}: {
  entityType: "Character" | "Background" | "Asset";
  entityId: string;
  name: string;
  image: ProductionV2EntityImage;
  imageLabel: string;
  perspectives: ProductionV2CatalogPerspective[];
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onTogglePerspectives: () => void;
  disabled?: boolean;
}) {
  const src = mediaUrl(image.displayImage || image.workflowImage);
  const perspectiveRegionId = `production-v2-${entityType.toLowerCase()}-${entityId}-perspectives`;
  const contain = entityType !== "Background";
  const viewportClass = entityType === "Character" ? "aspect-[2/3]" : "aspect-[4/3]";
  return (
    <article data-otg="production-v2-entity-card" data-entity-kind={`${entityType.toLowerCase()}-card`} data-entity-id={entityId} className={`overflow-hidden rounded-lg border ${selected ? "border-emerald-300 bg-emerald-300/10" : "border-white/10 bg-black/25"}`}>
      <button type="button" onClick={onSelect} disabled={disabled} aria-pressed={selected} aria-label={`${selected ? "Remove" : "Select"} ${entityType} ${name}`} className="block w-full text-left transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40">
        <div data-otg={`production-v2-${entityType.toLowerCase()}-thumbnail`} className={`${viewportClass} overflow-hidden bg-zinc-900`}>
          {src ? <img src={src} alt={`${name} ${imageLabel}`} className={`h-full w-full object-center ${contain ? "object-contain p-3" : "object-cover"}`} /> : <div className="flex h-full items-center justify-center text-xs font-bold text-zinc-600">No preview</div>}
        </div>
        <div className="px-3 py-2">
          <div className="break-words text-xs font-black text-zinc-100">{name}</div>
          <div className={`mt-1 text-[11px] font-bold ${selected ? "text-emerald-200" : "text-zinc-600"}`}>{selected ? "Selected" : imageLabel}</div>
        </div>
      </button>
      {selected && perspectives.length ? (
        <div className="border-t border-white/10">
          <button type="button" aria-expanded={expanded} aria-controls={perspectiveRegionId} aria-label={`${name} Perspectives`} onClick={onTogglePerspectives} className="flex min-h-10 w-full items-center justify-between px-3 py-2 text-xs font-bold text-zinc-400 hover:bg-white/[0.04] hover:text-white">
            <span>Perspectives</span><span aria-hidden="true">{expanded ? "-" : "+"}</span>
          </button>
          {expanded ? (
            <div id={perspectiveRegionId} data-otg="production-v2-perspectives" className="grid grid-cols-2 gap-2 border-t border-white/10 p-2">
              {perspectives.map((perspective) => {
                const perspectiveSrc = mediaUrl(perspective.displayImage || perspective.workflowImage);
                return (
                  <figure key={perspective.key} className="min-w-0">
                    <div className="aspect-square overflow-hidden rounded border border-white/10 bg-zinc-900">
                      {perspectiveSrc ? <img src={perspectiveSrc} alt={`${name} ${perspective.label} perspective`} className={`h-full w-full ${contain ? "object-contain p-1" : "object-cover"}`} /> : null}
                    </div>
                    <figcaption className="mt-1 break-words text-[10px] font-bold text-zinc-500">{perspective.label}</figcaption>
                  </figure>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function selectedSceneVersion(scene: ProductionV2Scene) {
  const selectedId = scene.activeMediaVersionId || scene.selectedGeneratedVersionId;
  return scene.mediaVersions.find((version) => version.id === selectedId) || scene.mediaVersions.at(-1) || null;
}

function versionLabel(version: ProductionV2SceneMediaVersion, index: number) {
  const labels: Record<ProductionV2SceneMediaVersion["versionType"], string> = {
    generated: "Generated",
    "visual-edit": "Visual edit",
    trimmed: "Trimmed",
    "audio-edit": "Audio edit",
    "assembly-source": "Assembly source",
  };
  return `${labels[version.versionType]} ${index + 1}`;
}

const STAGES = Object.keys(STAGE_LABELS) as ProductionV2Stage[];

function StageNavigator({ stage, onChange, position }: { stage: ProductionV2Stage; onChange: (stage: ProductionV2Stage) => void; position: "top" | "bottom" }) {
  const index = STAGES.indexOf(stage);
  return (
    <nav aria-label={`Production stage ${position}`} data-otg={`production-v2-stage-navigation-${position}`} className="mx-auto w-full max-w-md">
      <div className="production-v2-stage-bar rounded-lg border px-4 py-3 text-center text-sm font-black uppercase" data-testid={`production-v2-current-stage-${position}`}>{STAGE_LABELS[stage]}</div>
      <div className="mt-2 flex items-center justify-center gap-2" role="group" aria-label={`Production stage steps ${position}`}>
        {STAGES.map((item, itemIndex) => <button key={item} type="button" aria-label={`${STAGE_LABELS[item]} stage`} aria-pressed={item === stage} onClick={() => onChange(item)} className={`h-8 w-8 rounded border text-xs font-black ${item === stage ? "production-v2-control-active" : "border-white/10 bg-black/25 text-zinc-500 hover:border-white/25 hover:text-white"}`}>{itemIndex + 1}</button>)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" className={`${secondaryButton} min-h-9 py-1.5`} disabled={index === 0} onClick={() => onChange(STAGES[index - 1])}>Back</button>
        <button type="button" className={`${secondaryButton} min-h-9 py-1.5`} disabled={index === STAGES.length - 1} onClick={() => onChange(STAGES[index + 1])}>Next</button>
      </div>
    </nav>
  );
}

function SavedSceneCard({ scene, selected, onSelect, onOpen }: { scene: ProductionV2Scene; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  const version = selectedSceneVersion(scene);
  const preview = mediaUrl(version?.previewUrl || scene.generatedClip?.previewUrl || "");
  const status = productionV2SceneCardStatus(scene);
  return (
    <button
      type="button"
      onClick={() => { onSelect(); if (preview) onOpen(); }}
      aria-current={selected ? "true" : undefined}
      aria-label={`Open saved Scene ${scene.sceneNumber}`}
      data-testid={`production-v2-saved-scene-${scene.id}`}
      className={`min-w-0 overflow-hidden rounded-lg border text-left transition ${selected ? "production-v2-control-active" : "border-white/10 bg-black/25 hover:border-white/25"}`}
    >
      <div className="aspect-video overflow-hidden bg-zinc-950">
        {preview ? <video src={preview} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" aria-label={`Scene ${scene.sceneNumber} poster`} /> : <div className="flex h-full items-center justify-center px-2 text-center text-[10px] font-bold text-zinc-600">No media</div>}
      </div>
      <div className="space-y-1.5 p-2">
        <div className="flex items-center justify-between gap-1"><span className="text-xs font-black text-white">Scene {scene.sceneNumber}</span><span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-black uppercase text-zinc-300">{status}</span></div>
        <div className="break-words text-[10px] leading-4 text-zinc-500">{MODEL_LABELS[scene.model]} | {scene.durationSeconds}s</div>
      </div>
    </button>
  );
}

function SceneGrid({ scenes, activeSceneId, onSelect, onOpen, label = "Saved Scenes" }: { scenes: ProductionV2Scene[]; activeSceneId: string; onSelect: (sceneId: string) => void; onOpen: (sceneId: string) => void; label?: string }) {
  return (
    <section aria-label={label} data-testid="production-v2-saved-scenes">
      <div className="mb-2 flex items-center justify-between gap-3"><h2 className="text-xs font-black uppercase text-zinc-400">{label}</h2><span className="text-xs font-bold text-zinc-600">{scenes.length}</span></div>
      {scenes.length ? <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-otg="production-v2-compact-scene-grid">{scenes.slice(0, PRODUCTION_V2_MAX_SCENES).map((scene) => <SavedSceneCard key={scene.id} scene={scene} selected={scene.id === activeSceneId} onSelect={() => onSelect(scene.id)} onOpen={() => onOpen(scene.id)} />)}</div> : <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-3 text-xs font-bold text-zinc-600">Saved Scene cards appear here after Save Scene succeeds.</div>}
    </section>
  );
}

function SceneViewer({ scene, onClose }: { scene: ProductionV2Scene; onClose: () => void }) {
  const version = selectedSceneVersion(scene);
  const preview = mediaUrl(version?.previewUrl || scene.generatedClip?.previewUrl || "");
  if (!preview) return null;
  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/85 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="production-v2-scene-viewer-title" data-testid="production-v2-scene-viewer">
      <div className="w-full max-w-5xl rounded-lg border border-white/15 bg-zinc-950 p-3 shadow-2xl sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 id="production-v2-scene-viewer-title" className="text-base font-black text-white">Scene {scene.sceneNumber}</h2><button type="button" className={`${secondaryButton} min-h-9 px-3 py-1.5`} onClick={onClose}>Close</button></div>
        <video controls autoPlay playsInline preload="metadata" src={preview} className="aspect-video w-full bg-black" data-otg="production-v2-expanded-video" />
      </div>
    </div>
  );
}

function MediaVersionSelect({ scene, value, label, onChange }: { scene: ProductionV2Scene; value: string; label: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-black uppercase text-zinc-500">
      {label}
      <select aria-label={label} value={value} disabled={!scene.mediaVersions.length} onChange={(event) => onChange(event.target.value)} className={`${fieldClass} mt-2 normal-case`}>
        {!scene.mediaVersions.length ? <option value="">No media versions</option> : null}
        {scene.mediaVersions.map((version, index) => <option key={version.id} value={version.id}>{versionLabel(version, index)}</option>)}
      </select>
    </label>
  );
}

function StudioShell({
  kind,
  production,
  scene,
  savedScenes,
  readOnly,
  generationJob,
  onSelectScene,
  onOpenScene,
  onVersionChange,
  onProductionChange,
  onPersist,
  onH3Edit,
  onMessage,
}: {
  kind: "visual" | "audio";
  production: ProductionV2;
  scene: ProductionV2Scene;
  savedScenes: ProductionV2Scene[];
  readOnly: boolean;
  generationJob: ProductionV2GenerationJobPayload | null;
  onSelectScene: (sceneId: string) => void;
  onOpenScene: (sceneId: string) => void;
  onVersionChange: (versionId: string) => void;
  onProductionChange: (production: ProductionV2) => void;
  onPersist: () => Promise<ProductionV2 | null>;
  onH3Edit: (versionId: string, prompt: string) => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const version = selectedSceneVersion(scene);
  const preview = mediaUrl(version?.previewUrl || scene.generatedClip?.previewUrl || "");
  const title = kind === "visual" ? "Visual Studios" : "Audio Studios";
  const [operation, setOperation] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [sfxPrompt, setSfxPrompt] = useState("");
  const [duration, setDuration] = useState<number>(scene.durationSeconds);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState<number>(scene.durationSeconds);
  const [volumePercent, setVolumePercent] = useState(100);

  useEffect(() => {
    setDuration(scene.durationSeconds);
    setTrimStart(0);
    setTrimEnd(scene.durationSeconds);
  }, [scene.id, version?.id, scene.durationSeconds]);

  async function postProcess(action: "trim" | "volume" | "remove-background-music" | "woosh-sfx", extra: Record<string, unknown> = {}) {
    if (!version) return;
    setOperation(action);
    onMessage("");
    try {
      const persisted = await onPersist();
      if (!persisted) return;
      const response = await fetch("/api/production/v2/postprocess", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, productionId: production.id, sceneId: scene.id, versionId: version.id, ...extra }),
      });
      const json = await readJsonResponse<{ production: ProductionV2 }>(response);
      onProductionChange(json.production);
      onMessage(action === "trim" ? "Trimmed version created." : action === "volume" ? "Volume-adjusted version created." : action === "woosh-sfx" ? "Sony Woosh VFlow sound-effects version created." : "Background music removed with Demucs.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Post-production operation failed.");
    } finally {
      setOperation("");
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6" data-testid={`production-v2-${kind}-studios`}>
      <SceneGrid scenes={savedScenes} activeSceneId={scene.id} onSelect={onSelectScene} onOpen={onOpenScene} label={`${title} Scenes`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.36fr)]">
        <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase text-zinc-500">Scene {scene.sceneNumber}</p><h2 className="mt-1 text-lg font-black text-white">{title}</h2></div><span className="text-right text-xs text-zinc-500">{version ? versionLabel(version, scene.mediaVersions.indexOf(version)) : "No media"}</span></div>
          {preview ? <video controls playsInline preload="metadata" src={preview} onLoadedMetadata={(event) => { const next = event.currentTarget.duration; if (Number.isFinite(next) && next > 0) { setDuration(next); setTrimEnd(next); } }} className="aspect-video w-full rounded-lg bg-black" data-otg={`production-v2-${kind}-preview`} /> : <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-white/10 bg-black/25 text-sm font-bold text-zinc-600">Generate a Scene video to begin.</div>}
        </div>
        <aside className="space-y-4 rounded-lg border border-white/10 bg-zinc-950/70 p-4">
          <MediaVersionSelect scene={scene} value={version?.id || ""} label={`${title} media version`} onChange={onVersionChange} />
          {kind === "visual" ? <>
            <section className="border-t border-white/10 pt-4" data-otg="production-v2-h3-video-edit"><h3 className="text-xs font-black uppercase text-zinc-400">AI Video Edit</h3><p className="mt-2 text-xs text-zinc-500">Current source: {version ? versionLabel(version, scene.mediaVersions.indexOf(version)) : "None"}</p><label className="mt-3 block text-xs font-bold text-zinc-400">Describe your changes<textarea aria-label="AI video edit instructions" rows={4} value={editPrompt} disabled={readOnly} onChange={(event) => setEditPrompt(event.target.value)} className={`${fieldClass} mt-2 resize-y`} /></label><button type="button" className={`${productionPrimaryButton} mt-3 w-full`} disabled={Boolean(readOnly || !version || !editPrompt.trim() || productionV2GenerationIsActive(generationJob?.status))} onClick={() => void onH3Edit(version!.id, editPrompt)}>{generationJob?.operation === "visual-edit" && generationJob.status !== "completed" && generationJob.status !== "failed" ? generationJob.statusMessage || "Rendering Edit..." : "Render Edit"}</button></section>
            <section className="border-t border-white/10 pt-4" data-otg="production-v2-trim"><h3 className="text-xs font-black uppercase text-zinc-400">Trim</h3><div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px] text-zinc-500"><span>Original<br /><strong className="text-zinc-200">{duration.toFixed(2)}s</strong></span><span>In<br /><strong className="text-zinc-200">{trimStart.toFixed(2)}s</strong></span><span>Out<br /><strong className="text-zinc-200">{trimEnd.toFixed(2)}s</strong></span></div><label className="mt-3 block text-xs text-zinc-500">In point<input aria-label="Trim in point" type="range" min={0} max={Math.max(0.25, duration - 0.25)} step="0.05" value={Math.min(trimStart, Math.max(0, trimEnd - 0.25))} onChange={(event) => setTrimStart(Math.min(Number(event.target.value), trimEnd - 0.25))} className="mt-2 w-full" /></label><label className="mt-2 block text-xs text-zinc-500">Out point<input aria-label="Trim out point" type="range" min={0.25} max={duration} step="0.05" value={Math.max(trimEnd, trimStart + 0.25)} onChange={(event) => setTrimEnd(Math.max(Number(event.target.value), trimStart + 0.25))} className="mt-2 w-full" /></label><p className="mt-2 text-center text-xs font-bold text-zinc-300">Result: {Math.max(0, trimEnd - trimStart).toFixed(2)}s</p><button type="button" className={`${secondaryButton} mt-3 w-full`} disabled={Boolean(readOnly || !version || operation)} onClick={() => void postProcess("trim", { startSeconds: trimStart, endSeconds: trimEnd })}>{operation === "trim" ? "Trimming..." : "Apply Trim"}</button></section>
          </> : <>
            <section className="border-t border-white/10 pt-4" data-otg="production-v2-woosh-sfx"><h3 className="text-xs font-black uppercase text-zinc-400">Sound Effects</h3><p className="mt-2 text-xs text-zinc-500">Sony Woosh VFlow | video-to-audio</p><label className="mt-3 block text-xs font-bold text-zinc-400">Describe desired sound effects<textarea aria-label="Sound effects description" rows={4} value={sfxPrompt} disabled={readOnly} onChange={(event) => setSfxPrompt(event.target.value)} className={`${fieldClass} mt-2 resize-y`} /></label><button type="button" className={`${productionPrimaryButton} mt-3 w-full`} disabled={Boolean(readOnly || !version || operation)} onClick={() => void postProcess("woosh-sfx", { prompt: sfxPrompt, sfxVolume: 80 })}>{operation === "woosh-sfx" ? "Generating..." : "Generate Sound Effects"}</button><p className="mt-2 text-[10px] leading-4 text-amber-200/70">Public Woosh weights: CC-BY-NC, non-commercial.</p></section>
            <section className="border-t border-white/10 pt-4"><h3 className="text-xs font-black uppercase text-zinc-400">Remove Background Music</h3><button type="button" className={`${secondaryButton} mt-3 w-full`} disabled={Boolean(readOnly || !version || operation)} onClick={() => void postProcess("remove-background-music")}>{operation === "remove-background-music" ? "Separating..." : "Remove Background Music"}</button><p className="mt-2 text-[10px] leading-4 text-zinc-500">Demucs source separation preserves the non-music stem.</p></section>
            <section className="border-t border-white/10 pt-4"><h3 className="text-xs font-black uppercase text-zinc-400">Clip Volume</h3><label className="mt-3 block text-xs text-zinc-500">Volume: <strong className="text-zinc-200">{volumePercent}%</strong><input aria-label="Clip volume percent" type="range" min="0" max="200" step="1" value={volumePercent} disabled={readOnly} onChange={(event) => setVolumePercent(Number(event.target.value))} className="mt-2 w-full" /></label><button type="button" className={`${secondaryButton} mt-3 w-full`} disabled={Boolean(readOnly || !version || operation)} onClick={() => void postProcess("volume", { volumePercent })}>{operation === "volume" ? "Applying..." : "Apply Volume"}</button></section>
          </>}
        </aside>
      </div>
    </div>
  );
}

function AssemblyShell({
  production,
  savedScenes,
  readOnly,
  onSelectScene,
  onOpenScene,
  onMoveClip,
  onVersionChange,
  onAssemblyChange,
  onGenerateMusic,
  onRender,
  onApprove,
}: {
  production: ProductionV2;
  savedScenes: ProductionV2Scene[];
  readOnly: boolean;
  onSelectScene: (sceneId: string) => void;
  onOpenScene: (sceneId: string) => void;
  onMoveClip: (clipId: string, direction: -1 | 1) => void;
  onVersionChange: (clipId: string, versionId: string | null) => void;
  onAssemblyChange: (patch: Partial<ProductionV2AssemblyState>) => void;
  onGenerateMusic: (prompt: string) => Promise<void>;
  onRender: () => Promise<void>;
  onApprove: () => Promise<void>;
}) {
  const clips = [...production.assembly.clips].sort((left, right) => left.order - right.order);
  const selectedScene = production.scenes.find((scene) => scene.id === production.activeSceneId) || production.scenes[0];
  const selectedVersion = selectedScene ? selectedSceneVersion(selectedScene) : null;
  const selectedPreview = mediaUrl(selectedVersion?.previewUrl || selectedScene?.generatedClip?.previewUrl || "");
  const [musicPrompt, setMusicPrompt] = useState(production.assembly.musicGeneration.prompt);
  const [rendering, setRendering] = useState(false);

  useEffect(() => setMusicPrompt(production.assembly.musicGeneration.prompt), [production.assembly.musicGeneration.prompt]);

  function updateFade(kind: "fadeIn" | "fadeOut", patch: Partial<ProductionV2AssemblyState["fadeIn"]>) {
    onAssemblyChange({ [kind]: { ...production.assembly[kind], ...patch } });
  }

  function updateTrack(trackId: string, patch: Partial<ProductionV2AssemblyState["musicTracks"][number]>) {
    onAssemblyChange({ musicTracks: production.assembly.musicTracks.map((track) => track.id === trackId ? { ...track, ...patch } : track) });
  }

  function updateSfxTrack(
    trackId: string,
    patch: Partial<ProductionV2AssemblyState["sfxTracks"][number]>,
  ) {
    onAssemblyChange({
      sfxTracks: production.assembly.sfxTracks.map((track) =>
        track.id === trackId ? { ...track, ...patch } : track
      ),
    });
  }


  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6" data-testid="production-v2-assembly">
      <SceneGrid scenes={savedScenes} activeSceneId={production.activeSceneId} onSelect={onSelectScene} onOpen={onOpenScene} label="Assembly Scenes" />
      {selectedPreview ? <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-black text-white">Assembly Source Preview</h2><span className="text-xs text-zinc-500">Scene {selectedScene.sceneNumber}</span></div><video controls playsInline preload="metadata" src={selectedPreview} className="aspect-video w-full rounded-lg bg-black" data-otg="production-v2-assembly-preview" /></div> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.34fr)]">
        <div className="space-y-3">
          {clips.map((clip, index) => {
            const scene = production.scenes.find((item) => item.id === clip.sceneId);
            if (!scene) return null;
            return (
              <article key={clip.id} className={`rounded-lg border p-4 ${production.activeSceneId === scene.id ? "border-cyan-300/40 bg-cyan-300/[0.05]" : "border-white/10 bg-zinc-950/70"}`} data-testid={`production-v2-assembly-clip-${clip.id}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <button type="button" onClick={() => onSelectScene(scene.id)} className="min-w-0 text-left"><span className="block text-xs font-black uppercase text-zinc-500">Clip {index + 1}</span><span className="mt-1 block text-base font-black text-white">Scene {scene.sceneNumber}</span><span className="mt-1 block text-xs text-zinc-500">{MODEL_LABELS[scene.model]} | {scene.durationSeconds}s</span></button>
                  <div className="flex gap-2"><button type="button" className={secondaryButton} disabled={index === 0} aria-label={`Move Assembly Scene ${scene.sceneNumber} up`} onClick={() => onMoveClip(clip.id, -1)}>Up</button><button type="button" className={secondaryButton} disabled={index === clips.length - 1} aria-label={`Move Assembly Scene ${scene.sceneNumber} down`} onClick={() => onMoveClip(clip.id, 1)}>Down</button></div>
                </div>
                <div className="mt-4"><MediaVersionSelect scene={scene} value={clip.mediaVersionId || ""} label={`Assembly Scene ${scene.sceneNumber} source version`} onChange={(versionId) => onVersionChange(clip.id, versionId || null)} /></div>
              </article>
            );
          })}
          {!clips.length ? <div className="rounded-lg border border-dashed border-white/10 bg-black/20 p-8 text-center text-sm font-bold text-zinc-600">Save a Scene to add it to Assembly.</div> : null}
        </div>
        <aside className="space-y-4">
          <section className="rounded-lg border border-white/10 bg-zinc-950/70 p-4"><h3 className="text-xs font-black uppercase text-zinc-500">Fades</h3><div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs font-bold text-zinc-400"><span className="flex items-center gap-2"><input type="checkbox" checked={production.assembly.fadeIn.enabled} disabled={readOnly} onChange={(event) => updateFade("fadeIn", { enabled: event.target.checked })} />Beginning</span><input aria-label="Beginning fade duration" type="number" min="0" max="10" step="0.1" disabled={readOnly || !production.assembly.fadeIn.enabled} value={production.assembly.fadeIn.durationSeconds} onChange={(event) => updateFade("fadeIn", { durationSeconds: Math.max(0, Number(event.target.value)) })} className={`${fieldClass} mt-2`} /></label><label className="text-xs font-bold text-zinc-400"><span className="flex items-center gap-2"><input type="checkbox" checked={production.assembly.fadeOut.enabled} disabled={readOnly} onChange={(event) => updateFade("fadeOut", { enabled: event.target.checked })} />Ending</span><input aria-label="Ending fade duration" type="number" min="0" max="10" step="0.1" disabled={readOnly || !production.assembly.fadeOut.enabled} value={production.assembly.fadeOut.durationSeconds} onChange={(event) => updateFade("fadeOut", { durationSeconds: Math.max(0, Number(event.target.value)) })} className={`${fieldClass} mt-2`} /></label></div></section>
          <section className="rounded-lg border border-white/10 bg-zinc-950/70 p-4" data-otg="production-v2-assembly-sfx">
            <h3 className="text-xs font-black uppercase text-zinc-500">Sound Effects Timeline</h3>
            <p className="mt-2 text-xs leading-5 text-zinc-500">Woosh SFX timing is relative to its source Scene, so Scene reordering keeps each effect synchronized.</p>
            {production.assembly.sfxTracks.length ? production.assembly.sfxTracks.map((track) => {
              const sourceScene = production.scenes.find((item) => item.id === track.sceneId);
              return (
                <div key={track.id} className="mt-4 space-y-3 border-t border-white/10 pt-3">
                  <div>
                    <p className="text-[10px] font-black uppercase text-zinc-500">Scene {sourceScene?.sceneNumber ?? "?"}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-400">{track.prompt || "Generated Woosh sound effects"}</p>
                  </div>
                  <audio controls preload="metadata" src={mediaUrl(track.previewUrl || "")} className="w-full" />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] font-bold text-zinc-500">
                      Start in Scene
                      <input
                        aria-label="SFX start time"
                        type="number"
                        min="0"
                        step="0.05"
                        value={track.startSeconds}
                        disabled={readOnly}
                        onChange={(event) => {
                          const startSeconds = Math.max(0, Number(event.target.value));
                          updateSfxTrack(track.id, {
                            startSeconds,
                            endSeconds: track.endSeconds !== null && track.endSeconds <= startSeconds
                              ? startSeconds + 0.05
                              : track.endSeconds,
                          });
                        }}
                        className={`${fieldClass} mt-1`}
                      />
                    </label>
                    <label className="text-[10px] font-bold text-zinc-500">
                      End in Scene
                      <input
                        aria-label="SFX end time"
                        type="number"
                        min="0"
                        step="0.05"
                        value={track.endSeconds ?? ""}
                        placeholder="Scene end"
                        disabled={readOnly}
                        onChange={(event) => updateSfxTrack(track.id, {
                          endSeconds: event.target.value
                            ? Math.max(track.startSeconds + 0.05, Number(event.target.value))
                            : null,
                        })}
                        className={`${fieldClass} mt-1`}
                      />
                    </label>
                  </div>
                  <label className="block text-[10px] font-bold text-zinc-500">
                    SFX volume: {Math.round(track.volume * 100)}%
                    <input
                      aria-label="SFX volume"
                      type="range"
                      min="0"
                      max="200"
                      step="1"
                      value={Math.round(track.volume * 100)}
                      disabled={readOnly}
                      onChange={(event) => updateSfxTrack(track.id, {
                        volume: Number(event.target.value) / 100,
                      })}
                      className="mt-1 w-full"
                    />
                  </label>
                  <button
                    type="button"
                    className={`${secondaryButton} w-full`}
                    disabled={readOnly}
                    onClick={() => onAssemblyChange({
                      sfxTracks: production.assembly.sfxTracks.filter((item) => item.id !== track.id),
                    })}
                  >
                    Remove SFX
                  </button>
                </div>
              );
            }) : <p className="mt-3 text-xs text-zinc-600">Generate sound effects in Audio Studios to add timed SFX here.</p>}
          </section>
          <section className="rounded-lg border border-white/10 bg-zinc-950/70 p-4"><h3 className="text-xs font-black uppercase text-zinc-500">Background Music</h3><p className="mt-2 text-xs text-zinc-500">MiniMax Music 3.0</p><label className="mt-3 block text-xs font-bold text-zinc-400">Describe music<textarea aria-label="Background music description" rows={3} value={musicPrompt} disabled={readOnly} onChange={(event) => setMusicPrompt(event.target.value)} className={`${fieldClass} mt-2 resize-y`} /></label><button type="button" className={`${secondaryButton} mt-3 w-full`} disabled={Boolean(readOnly || !musicPrompt.trim() || production.assembly.musicGeneration.status === "generating")} onClick={() => void onGenerateMusic(musicPrompt)}>{production.assembly.musicGeneration.status === "generating" ? "Generating Music..." : "Generate Music"}</button>{production.assembly.musicGeneration.error ? <p className="mt-2 text-xs text-red-200">{production.assembly.musicGeneration.error}</p> : null}
            {production.assembly.musicTracks.map((track) => <div key={track.id} className="mt-4 space-y-3 border-t border-white/10 pt-3"><audio controls preload="metadata" src={mediaUrl(track.previewUrl || "")} className="w-full" /><div className="grid grid-cols-2 gap-2"><label className="text-[10px] font-bold text-zinc-500">Start<input aria-label="Music start time" type="number" min="0" step="0.1" value={track.startSeconds} disabled={readOnly} onChange={(event) => updateTrack(track.id, { startSeconds: Math.max(0, Number(event.target.value)) })} className={`${fieldClass} mt-1`} /></label><label className="text-[10px] font-bold text-zinc-500">End<input aria-label="Music end time" type="number" min="0" step="0.1" value={track.endSeconds ?? ""} placeholder="Full" disabled={readOnly} onChange={(event) => updateTrack(track.id, { endSeconds: event.target.value ? Math.max(0, Number(event.target.value)) : null })} className={`${fieldClass} mt-1`} /></label><label className="text-[10px] font-bold text-zinc-500">Fade in<input aria-label="Music fade in" type="number" min="0" step="0.1" value={track.fadeInSeconds} disabled={readOnly} onChange={(event) => updateTrack(track.id, { fadeInSeconds: Math.max(0, Number(event.target.value)) })} className={`${fieldClass} mt-1`} /></label><label className="text-[10px] font-bold text-zinc-500">Fade out<input aria-label="Music fade out" type="number" min="0" step="0.1" value={track.fadeOutSeconds} disabled={readOnly} onChange={(event) => updateTrack(track.id, { fadeOutSeconds: Math.max(0, Number(event.target.value)) })} className={`${fieldClass} mt-1`} /></label></div><label className="block text-[10px] font-bold text-zinc-500">Music volume: {Math.round(track.volume * 100)}%<input aria-label="Music volume" type="range" min="0" max="200" value={Math.round(track.volume * 100)} disabled={readOnly} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) / 100 })} className="mt-1 w-full" /></label></div>)}
          </section>
          <button type="button" className={`${productionPrimaryButton} w-full`} disabled={Boolean(readOnly || rendering || !clips.length || clips.some((clip) => !clip.mediaVersionId))} onClick={() => { setRendering(true); void onRender().finally(() => setRendering(false)); }}>{rendering || production.assembly.renderStatus === "rendering" ? "Rendering..." : "Final Assemble / Render"}</button>
          {production.assembly.finalMedia?.previewUrl ? <video controls playsInline preload="metadata" src={mediaUrl(production.assembly.finalMedia.previewUrl)} className="aspect-video w-full rounded-lg bg-black" data-otg="production-v2-final-video" /> : null}
          <button type="button" className={`${secondaryButton} w-full`} disabled={Boolean(readOnly || production.assembly.renderStatus !== "rendered" || !production.assembly.finalMedia)} onClick={() => void onApprove()}>Approve Final Production</button>
          <p className="text-xs leading-5 text-zinc-500">Rendering does not complete the Production. Approval is explicit.</p>
        </aside>
      </div>
    </div>
  );
}

function characterSelection(item: ProductionV2CatalogCharacter): ProductionV2CharacterSelection {
  return {
    characterId: item.id,
    snapshotName: item.name,
    sourceUpdatedAt: item.updatedAt,
    defaultImageRef: item.defaultImage,
    characterCardRef: item.characterCard,
    identityDescription: item.identityDescription,
    speaking: false,
    visible: true,
    voiceRef: item.voiceRef,
  };
}

function backgroundSelection(item: ProductionV2CatalogBackground): ProductionV2BackgroundSelection {
  return { backgroundId: item.id, snapshotName: item.name, sourceUpdatedAt: item.updatedAt, masterImageRef: item.masterImage, identityDescription: item.identityDescription };
}

function assetSelection(item: ProductionV2CatalogAsset): ProductionV2AssetSelection {
  return { assetId: item.id, snapshotName: item.name, sourceUpdatedAt: item.updatedAt, defaultImageRef: item.defaultImage, identityDescription: item.identityDescription };
}

function visualReference(
  kind: "character" | "background" | "asset",
  id: string,
  name: string,
  displayImage: ProductionV2EntityImage,
  generationImage = displayImage,
): ProductionV2VisualReference {
  return {
    id: `${kind}:${id}`,
    sourceKind: kind,
    sourceId: id,
    name,
    generationSourceType: kind === "character" ? "character-card" : kind === "background" ? "background-master" : "asset-default",
    displayImage: displayImage.displayImage || displayImage.workflowImage,
    workflowImage: generationImage.workflowImage || generationImage.displayImage,
  };
}

export default function ProductionV2Panel() {
  const [homeView, setHomeView] = useState<HomeView>("actions");
  const [production, setProduction] = useState<ProductionV2 | null>(null);
  const [drafts, setDrafts] = useState<ProductionV2Summary[]>([]);
  const [completed, setCompleted] = useState<ProductionV2Summary[]>([]);
  const [characters, setCharacters] = useState<ProductionV2CatalogCharacter[]>([]);
  const [backgrounds, setBackgrounds] = useState<ProductionV2CatalogBackground[]>([]);
  const [assets, setAssets] = useState<ProductionV2CatalogAsset[]>([]);
  const [expandedState, setExpandedState] = useState<{ scope: string; groups: Set<string> }>(() => ({ scope: "", groups: new Set() }));
  const [createName, setCreateName] = useState("");
  const [createModel, setCreateModel] = useState<ProductionV2Model>("minimax-h3");
  const [deleteCandidate, setDeleteCandidate] = useState<ProductionV2Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [generationSubmitting, setGenerationSubmitting] = useState(false);
  const [videoRefreshBusy, setVideoRefreshBusy] = useState(false);
  const [videoRetrySubmitting, setVideoRetrySubmitting] = useState(false);
  const [generationJob, setGenerationJob] = useState<ProductionV2GenerationJobPayload | null>(null);
  const [viewerSceneId, setViewerSceneId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const readOnly = production?.status === "completed";

  const selectedScene = useMemo(() => production?.scenes.find((scene) => scene.id === production.activeSceneId) || production?.scenes[0] || null, [production]);
  const productionId = production?.id || "";
  const activeSceneId = production?.activeSceneId || "";
  const expansionScope = production && selectedScene ? `${production.id}:${selectedScene.id}` : "";
  const expandedGroups = expandedState.scope === expansionScope ? expandedState.groups : EMPTY_EXPANDED_GROUPS;
  const currentPrompt = selectedScene?.promptStateByMode[selectedScene.generationMode] || null;
  const readiness = selectedScene ? productionV2GenerationReadiness(selectedScene) : { ok: false, reason: "No scene selected." };
  const generationActive = productionV2GenerationIsActive(generationJob?.status);
  const selectedStoryboardVersion = selectedScene
    ? selectedScene.mediaVersions.at(-1) || selectedSceneVersion(selectedScene)
    : null;
  const storyboardVideoSrc = mediaUrl(
    selectedStoryboardVersion?.previewUrl || generationJob?.videoUrl || selectedScene?.generatedClip?.previewUrl || "",
  );
  const hasPriorVideoAttempt = Boolean(generationJob || selectedScene?.generationAttempts?.length || selectedScene?.mediaVersions?.some((version) => version.versionType === "generated"));
  const savedScenes = useMemo(() => production ? productionV2SavedScenes(production) : [], [production]);
  const activeStage = production?.activeStage || "storyboard";
  const viewerScene = viewerSceneId ? production?.scenes.find((scene) => scene.id === viewerSceneId) || null : null;

  async function refreshHome(restoreActive = false) {
    const response = await fetch("/api/production/v2", { credentials: "include", cache: "no-store" });
    const json = await readJsonResponse<ProductionV2ListPayload>(response);
    setDrafts(json.drafts || []);
    setCompleted(json.completed || []);
    if (restoreActive && json.activeProduction) setProduction(json.activeProduction);
  }

  async function refreshVideoState() {
    if (!productionId || !activeSceneId || videoRefreshBusy) return;
    setVideoRefreshBusy(true);
    setMessage("");
    try {
      const jobResponse = await fetch(`/api/production/v2/generation?productionId=${encodeURIComponent(productionId)}&sceneId=${encodeURIComponent(activeSceneId)}`, { credentials: "include", cache: "no-store" });
      let latestJob: ProductionV2GenerationJobPayload | null = null;
      if (jobResponse.status !== 404) {
        latestJob = (await readJsonResponse<{ job: ProductionV2GenerationJobPayload }>(jobResponse)).job;
      }
      const productionResponse = await fetch(`/api/production/v2?mode=load&productionId=${encodeURIComponent(productionId)}`, { credentials: "include", cache: "no-store" });
      const loaded = await readJsonResponse<{ production: ProductionV2 }>(productionResponse);
      setGenerationJob(latestJob);
      setProduction(loaded.production);
      const refreshedScene = loaded.production.scenes.find((scene) => scene.id === activeSceneId);
      setMessage(
        latestJob
          ? `Refreshed durable video state: ${latestJob.statusMessage || latestJob.status}. ${refreshedScene?.mediaVersions.length || 0} media version(s) available.`
          : `Refreshed durable video state. ${refreshedScene?.mediaVersions.length || 0} media version(s) available; no generation job exists yet.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh durable video state.");
    } finally {
      setVideoRefreshBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/production/v2", { credentials: "include", cache: "no-store" });
        const json = await readJsonResponse<ProductionV2ListPayload>(response);
        if (cancelled) return;
        setDrafts(json.drafts || []);
        setCompleted(json.completed || []);
        if (json.activeProduction) setProduction(json.activeProduction);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load Production V2.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!productionId || !activeSceneId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/production/v2/references", { credentials: "include", cache: "no-store" });
        const json = await readJsonResponse<ReferenceCatalogPayload>(response);
        if (cancelled) return;
        setCharacters(json.characters || []);
        setBackgrounds(json.backgrounds || []);
        setAssets(json.assets || []);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load saved references.");
      }
    })();
    return () => { cancelled = true; };
  }, [productionId, activeSceneId]);

  useEffect(() => {
    if (!productionId || !activeSceneId) {
      setGenerationJob(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function poll() {
      try {
        const response = await fetch(`/api/production/v2/generation?productionId=${encodeURIComponent(productionId)}&sceneId=${encodeURIComponent(activeSceneId)}`, { credentials: "include", cache: "no-store" });
        if (response.status === 404) {
          if (!cancelled) setGenerationJob(null);
          return;
        }
        const json = await readJsonResponse<{ job: ProductionV2GenerationJobPayload }>(response);
        if (cancelled) return;
        setGenerationJob(json.job);
        if (json.job.status === "completed") {
          const productionResponse = await fetch(`/api/production/v2?mode=load&productionId=${encodeURIComponent(productionId)}`, { credentials: "include", cache: "no-store" });
          const loaded = await readJsonResponse<{ production: ProductionV2 }>(productionResponse);
          if (!cancelled) setProduction(loaded.production);
          return;
        }
        if (json.job.status === "failed") return;
        timer = setTimeout(poll, 3000);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not read H3 generation status.");
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [productionId, activeSceneId, generationJob?.id]);

  useEffect(() => {
    if (!productionId || production?.assembly.musicGeneration.status !== "generating") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function pollMusic() {
      try {
        const response = await fetch(`/api/production/v2/music?productionId=${encodeURIComponent(productionId)}`, { credentials: "include", cache: "no-store" });
        const json = await readJsonResponse<{ production: ProductionV2; generation: ProductionV2["assembly"]["musicGeneration"] }>(response);
        if (cancelled) return;
        setProduction(json.production);
        if (json.generation.status === "generating") timer = setTimeout(pollMusic, 4_000);
        else if (json.generation.status === "ready") setMessage("MiniMax Music 3.0 track is ready for Assembly.");
        else if (json.generation.status === "failed") setMessage(json.generation.error || "MiniMax Music 3.0 generation failed.");
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not read MiniMax Music 3.0 status.");
      }
    }
    void pollMusic();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [productionId, production?.assembly.musicGeneration.status, production?.assembly.musicGeneration.generationId]);

  async function createProduction() {
    if (!createName.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/production/v2", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name: createName.trim(), defaultModel: createModel }),
      });
      const json = await readJsonResponse<{ production: ProductionV2 }>(response);
      setProduction(json.production);
      setCreateName("");
      setHomeView("actions");
      setMessage("Production created.");
      await refreshHome(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create production.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProduction(nextProduction = production, successMessage = "Production saved.") {
    if (!nextProduction) return null;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/production/v2", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", production: nextProduction }),
      });
      const json = await readJsonResponse<{ production: ProductionV2 }>(response);
      setProduction(json.production);
      setMessage(successMessage);
      await refreshHome(false);
      return json.production;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save production.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openProduction(item: ProductionV2Summary) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/production/v2?mode=load&productionId=${encodeURIComponent(item.id)}`, { credentials: "include", cache: "no-store" });
      const json = await readJsonResponse<{ production: ProductionV2 }>(response);
      if (json.production.status === "draft") {
        await fetch("/api/production/v2", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "activate", productionId: json.production.id }),
        }).then((result) => readJsonResponse(result));
      }
      setProduction(json.production);
      setHomeView("actions");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load production.");
    } finally {
      setBusy(false);
    }
  }

  async function returnHome() {
    if (production?.status === "draft") {
      await fetch("/api/production/v2", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", productionId: "" }),
      }).catch(() => null);
    }
    setProduction(null);
    setHomeView("actions");
    await refreshHome(false).catch(() => null);
  }

  async function confirmDelete() {
    if (!deleteCandidate) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/production/v2", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", productionId: deleteCandidate.id }),
      });
      const json = await readJsonResponse<{ drafts?: ProductionV2Summary[]; completed?: ProductionV2Summary[] }>(response);
      setDrafts(json.drafts || []);
      setCompleted(json.completed || []);
      setMessage(`${deleteCandidate.name} deleted.`);
      setDeleteCandidate(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete production.");
    } finally {
      setBusy(false);
    }
  }

  function updateSelectedScene(updater: (scene: ProductionV2Scene) => ProductionV2Scene) {
    setProduction((current) => current ? { ...current, scenes: current.scenes.map((scene) => scene.id === current.activeSceneId ? updater(scene) : scene) } : current);
  }

  function updateSharedSceneInput(updater: (scene: ProductionV2Scene) => ProductionV2Scene, syncReferences = false) {
    updateSelectedScene((scene) => {
      const invalidated = invalidateProductionV2Prompts(updater(scene));
      return syncReferences ? syncProductionV2ReferencePlan(invalidated) : invalidated;
    });
  }

  function updatePromptOption<K extends keyof ProductionV2PromptOptions>(key: K, value: ProductionV2PromptOptions[K]) {
    updateSharedSceneInput((scene) => ({ ...scene, promptOptions: { ...scene.promptOptions, [key]: value } }));
  }

  function updateH3UserLoras(updater: (current: ProductionV2H3UserLoraState) => ProductionV2H3UserLoraState) {
    updateSharedSceneInput((scene) => ({
      ...scene,
      modelState: {
        ...scene.modelState,
        h3: {
          ...scene.modelState.h3,
          userLoras: updater(scene.modelState.h3.userLoras),
        },
      },
    }));
  }

  function toggleExpanded(key: string) {
    setExpandedState((current) => {
      const next = new Set(current.scope === expansionScope ? current.groups : []);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { scope: expansionScope, groups: next };
    });
  }

  function toggleCharacter(item: ProductionV2CatalogCharacter) {
    updateSharedSceneInput((scene) => {
      const selected = scene.selectedCharacters.some((entry) => entry.characterId === item.id);
      return { ...scene, selectedCharacters: selected ? scene.selectedCharacters.filter((entry) => entry.characterId !== item.id) : [...scene.selectedCharacters, characterSelection(item)] };
    }, true);
  }

  function selectBackground(item: ProductionV2CatalogBackground) {
    updateSharedSceneInput((scene) => ({ ...scene, selectedBackground: scene.selectedBackground?.backgroundId === item.id ? null : backgroundSelection(item) }), true);
  }

  function toggleAsset(item: ProductionV2CatalogAsset) {
    updateSharedSceneInput((scene) => {
      const selected = scene.selectedAssets.some((entry) => entry.assetId === item.id);
      return { ...scene, selectedAssets: selected ? scene.selectedAssets.filter((entry) => entry.assetId !== item.id) : [...scene.selectedAssets, assetSelection(item)] };
    }, true);
  }

  function toggleSpeaker(characterId: string) {
    if (!selectedScene) return;
    const character = selectedScene.selectedCharacters.find((item) => item.characterId === characterId);
    if (!character) return;
    if (!character.speaking && !character.voiceRef?.sourcePath) {
      setMessage(`${character.snapshotName} has no saved Character voice.`);
      return;
    }
    if (!character.speaking && productionV2SpeakingCharacters(selectedScene).length >= PRODUCTION_V2_H3_MAX_SPEAKERS) {
      setMessage(`MiniMax H3 Reference-to-Video supports at most ${PRODUCTION_V2_H3_MAX_SPEAKERS} speaking Characters. No voice was dropped.`);
      return;
    }
    if (character.speaking && selectedScene.dialogueTurns.some((turn) => turn.speakerCharacterId === characterId)) {
      setMessage("Remove this Character's dialogue turns before removing them as a speaker.");
      return;
    }
    setMessage("");
    updateSharedSceneInput((scene) => ({
      ...scene,
      selectedCharacters: scene.selectedCharacters.map((item) => item.characterId === characterId ? { ...item, speaking: !item.speaking } : item),
    }), true);
  }

  function addDialogueTurn() {
    if (!selectedScene) return;
    const speaker = productionV2SpeakingCharacters(selectedScene)[0];
    if (!speaker) {
      setMessage("Choose at least one Character in Who Speaks? before adding dialogue.");
      return;
    }
    setMessage("");
    updateSharedSceneInput((scene) => ({ ...scene, dialogueTurns: [...scene.dialogueTurns, createProductionV2DialogueTurn(speaker.characterId)] }));
  }

  function updateDialogueTurn(turnId: string, patch: Partial<Pick<ProductionV2DialogueTurn, "speakerCharacterId" | "text">>) {
    updateSharedSceneInput((scene) => ({
      ...scene,
      dialogueTurns: scene.dialogueTurns.map((turn) => turn.id === turnId ? { ...turn, ...patch } : turn),
    }));
  }

  function moveDialogueTurn(turnId: string, direction: -1 | 1) {
    updateSharedSceneInput((scene) => {
      const index = scene.dialogueTurns.findIndex((turn) => turn.id === turnId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= scene.dialogueTurns.length) return scene;
      const dialogueTurns = [...scene.dialogueTurns];
      [dialogueTurns[index], dialogueTurns[nextIndex]] = [dialogueTurns[nextIndex], dialogueTurns[index]];
      return { ...scene, dialogueTurns };
    });
  }

  function deleteDialogueTurn(turnId: string) {
    setMessage("");
    updateSharedSceneInput((scene) => ({ ...scene, dialogueTurns: scene.dialogueTurns.filter((turn) => turn.id !== turnId) }));
  }

  function setStartingImage(reference: ProductionV2VisualReference) {
    updateSharedSceneInput((scene) => ({
      ...scene,
      modelState: {
        ...scene.modelState,
        h3: { ...scene.modelState.h3, imageToVideo: { startingImage: scene.modelState.h3.imageToVideo.startingImage?.id === reference.id ? null : reference } },
      },
    }));
  }

  function changeModel(model: ProductionV2Model) {
    updateSelectedScene((scene) => syncProductionV2ReferencePlan(switchProductionV2SceneModel(scene, model)));
  }

  function changeMode(mode: ProductionV2GenerationMode) {
    updateSelectedScene((scene) => syncProductionV2ReferencePlan(switchProductionV2SceneMode(scene, mode)));
  }

  async function buildPrompt() {
    if (!selectedScene) return;
    setBusy(true);
    setMessage("");
    try {
      if (selectedScene.model === "minimax-h3") {
        const response = await fetch("/api/production/v2/prompt", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scene: selectedScene }),
        });
        const json = await readJsonResponse<PromptBuildPayload>(response);
        updateSelectedScene((scene) => {
          const resolved = {
            ...scene,
            referencePlan: json.referencePlan,
            modelState: {
              ...scene.modelState,
              h3: { ...scene.modelState.h3, referenceToVideo: { resolvedVoiceBindings: json.referencePlan.resolvedVoiceReferences } },
            },
          };
          return buildProductionV2ScenePrompt(resolved, json.scenePrompt, json.builderId, json.lockedReferenceContext);
        });
        setMessage(`Scene Prompt built with ${json.provider}${json.repaired ? " after validation repair" : ""}. Review both prompt layers before generation.`);
      } else {
        const built = buildProductionPrompt({ model: selectedScene.model, mode: selectedScene.generationMode, scene: selectedScene });
        updateSelectedScene((scene) => buildProductionV2ScenePrompt(scene, built.scenePrompt, built.builderId, built.lockedReferenceContext));
        setMessage("LTX Scene Prompt built. Review the exact final prompt before generation.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not build the Scene Prompt.");
    } finally {
      setBusy(false);
    }
  }

  function reviewFinalPrompt() {
    try {
      updateSelectedScene((scene) => reviewProductionV2FinalPrompt(scene));
      setMessage("Locked References and the exact Final Prompt were reviewed. No generation was submitted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not review final prompt.");
    }
  }

  async function generateVideo() {
    if (!production || !selectedScene || selectedScene.model !== "minimax-h3") return;
    setGenerationSubmitting(true);
    setMessage("");
    try {
      const saved = await saveProduction(production, "Scene saved for MiniMax H3 generation.");
      if (!saved) return;
      const savedScene = saved.scenes.find((scene) => scene.id === selectedScene.id);
      if (!savedScene) throw new Error("Saved Production no longer contains this Scene.");
      const response = await fetch("/api/production/v2/generation", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productionId: saved.id, sceneId: savedScene.id }),
      });
      const json = await readJsonResponse<{ job: ProductionV2GenerationJobPayload }>(response);
      setGenerationJob(json.job);
      setMessage(json.job.statusMessage || "Waiting for GPU");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit MiniMax H3 generation.");
    } finally {
      setGenerationSubmitting(false);
    }
  }

  async function retryVideo() {
    if (!production || !selectedScene || selectedScene.model !== "minimax-h3" || generationActive) return;
    setVideoRetrySubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/production/v2/generation", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productionId: production.id, sceneId: selectedScene.id, action: "retry" }),
      });
      const json = await readJsonResponse<{ job: ProductionV2GenerationJobPayload }>(response);
      setGenerationJob(json.job);
      setMessage(`${json.job.statusMessage || "Retry queued"}. Exact reviewed prompt reused in new job ${json.job.id}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not retry MiniMax H3 generation.");
    } finally {
      setVideoRetrySubmitting(false);
    }
  }

  async function addScene() {
    if (!production || production.scenes.length >= PRODUCTION_V2_MAX_SCENES) return;
    try {
      await saveProduction(addProductionV2Scene(production, selectedScene?.model || production.defaultModel), "Scene added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add scene.");
    }
  }

  function selectScene(sceneId: string) {
    setProduction((current) => current?.scenes.some((scene) => scene.id === sceneId) ? { ...current, activeSceneId: sceneId } : current);
  }

  function changeStage(stage: ProductionV2Stage) {
    setProduction((current) => current ? { ...current, activeStage: stage } : current);
  }

  function changeStudioVersion(versionId: string) {
    updateSelectedScene((scene) => selectProductionV2SceneMediaVersion(scene, versionId, "active"));
  }

  function moveAssemblyClip(clipId: string, direction: -1 | 1) {
    setProduction((current) => current ? moveProductionV2AssemblyClip(current, clipId, direction) : current);
  }

  function changeAssemblyClipVersion(clipId: string, versionId: string | null) {
    setProduction((current) => current ? selectProductionV2AssemblyClipVersion(current, clipId, versionId) : current);
  }

  function changeAssembly(patch: Partial<ProductionV2AssemblyState>) {
    setProduction((current) => current ? { ...current, assembly: { ...current.assembly, ...patch } } : current);
  }

  async function submitH3VisualEdit(versionId: string, editPrompt: string) {
    if (!production || !selectedScene) return;
    setGenerationSubmitting(true);
    setMessage("");
    try {
      const saved = await saveProduction(production, "Visual edit source saved.");
      if (!saved) return;
      const response = await fetch("/api/production/v2/generation", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "visual-edit", productionId: saved.id, sceneId: selectedScene.id, versionId, editPrompt }),
      });
      const json = await readJsonResponse<{ job: ProductionV2GenerationJobPayload }>(response);
      setGenerationJob(json.job);
      setMessage(json.job.statusMessage || "Waiting for GPU");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit MiniMax H3 video edit.");
    } finally {
      setGenerationSubmitting(false);
    }
  }

  async function generateAssemblyMusic(prompt: string) {
    if (!production) return;
    setMessage("");
    try {
      const saved = await saveProduction(production, "Assembly settings saved.");
      if (!saved) return;
      const response = await fetch("/api/production/v2/music", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productionId: saved.id, prompt }) });
      const json = await readJsonResponse<{ production: ProductionV2 }>(response);
      setProduction(json.production);
      setMessage("MiniMax Music 3.0 generation started.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start MiniMax Music 3.0.");
    }
  }

  async function renderAssembly() {
    if (!production) return;
    setMessage("");
    const saved = await saveProduction(production, "Assembly settings saved for render.");
    if (!saved) return;
    try {
      const response = await fetch("/api/production/v2/postprocess", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "render-assembly", productionId: saved.id }) });
      const json = await readJsonResponse<{ production: ProductionV2 }>(response);
      setProduction(json.production);
      setMessage("Final Production rendered. Review it before approval.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Final Assembly render failed.");
    }
  }

  async function approveFinalProduction() {
    if (!production) return;
    setMessage("");
    try {
      const response = await fetch("/api/production/v2/postprocess", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve-final", productionId: production.id }) });
      const json = await readJsonResponse<{ production: ProductionV2 }>(response);
      setProduction(json.production);
      setMessage("Final Production approved and completed.");
      await refreshHome(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not approve the final Production.");
    }
  }

  async function saveScene() {
    if (!production || !selectedScene) return;
    const nextScene = markProductionV2SceneSaved(selectedScene);
    const nextProduction = syncProductionV2AssemblyClips({ ...production, scenes: production.scenes.map((scene) => scene.id === nextScene.id ? nextScene : scene) });
    await saveProduction(nextProduction, `Scene ${nextScene.sceneNumber} saved.`);
  }

  if (loading) return <div className="mt-20 min-h-[60vh] rounded-lg border border-white/10 bg-zinc-950 p-6 text-sm font-bold text-zinc-400 sm:mt-0">Loading Production...</div>;

  if (!production) {
    return (
      <section data-otg="production-v2-home" className="mt-20 min-h-[calc(100vh-150px)] rounded-lg border border-white/10 bg-[#090b10] text-zinc-100 shadow-2xl sm:mt-0">
        <header className="border-b border-white/10 px-4 py-5 sm:px-6"><p className="text-xs font-black uppercase text-cyan-200/70">Production V2</p><h1 className="mt-2 text-2xl font-black text-white sm:text-3xl">Production</h1></header>
        <div className="mx-auto max-w-6xl p-4 sm:p-6">
          {message ? <div role="status" className="mb-4 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">{message}</div> : null}
          {homeView === "actions" ? <div className="grid gap-3 sm:grid-cols-2" data-otg="production-v2-home-actions"><HomeAction title="Create Production" subtitle="Start a new production." accent="bg-cyan-300" onClick={() => setHomeView("create")} /><HomeAction title="Load Production" subtitle={`${drafts.length} saved draft${drafts.length === 1 ? "" : "s"}.`} accent="bg-emerald-300" onClick={() => setHomeView("load")} /><HomeAction title="Delete Production" subtitle="Remove one selected draft." accent="bg-red-300" onClick={() => setHomeView("delete")} /><HomeAction title="Completed Productions" subtitle={`${completed.length} archived production${completed.length === 1 ? "" : "s"}.`} accent="bg-amber-300" onClick={() => setHomeView("completed")} /></div> : null}
          {homeView === "create" ? <div data-otg="production-v2-create"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-xl font-black">Create Production</h2><button className={secondaryButton} onClick={() => setHomeView("actions")}>Back</button></div><label className="text-sm font-bold text-zinc-300" htmlFor="production-v2-name">Production name</label><input id="production-v2-name" value={createName} onChange={(event) => setCreateName(event.target.value)} className={`${fieldClass} mt-2`} maxLength={120} autoFocus /><div className="mt-6 text-sm font-bold text-zinc-300">First scene model</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => setCreateModel("minimax-h3")} aria-pressed={createModel === "minimax-h3"} className={`rounded-lg border p-4 text-left ${createModel === "minimax-h3" ? "border-cyan-300 bg-cyan-300/10" : "border-white/10 bg-black/25"}`}><span className="block font-black text-white">MiniMax H3</span><span className="mt-2 block text-sm text-zinc-400">Higher quality | Slower</span></button><button type="button" onClick={() => setCreateModel("ltx-2.5")} aria-pressed={createModel === "ltx-2.5"} className={`rounded-lg border p-4 text-left ${createModel === "ltx-2.5" ? "border-emerald-300 bg-emerald-300/10" : "border-white/10 bg-black/25"}`}><span className="block font-black text-white">LTX 2.5</span><span className="mt-2 block text-sm text-zinc-400">Faster | Lower quality</span></button></div><button type="button" className={`${primaryButton} mt-6`} disabled={busy || !createName.trim()} onClick={() => void createProduction()}>{busy ? "Creating..." : "Create"}</button></div> : null}
          {homeView === "load" ? <div data-otg="production-v2-load"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-xl font-black">Load Production</h2><button className={secondaryButton} onClick={() => setHomeView("actions")}>Back</button></div>{drafts.length ? drafts.map((item) => <SummaryRow key={item.id} item={item} actionLabel="Open" onAction={() => void openProduction(item)} />) : <p className="py-6 text-sm text-zinc-500">No saved drafts.</p>}</div> : null}
          {homeView === "delete" ? <div data-otg="production-v2-delete"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-xl font-black">Delete Production</h2><button className={secondaryButton} onClick={() => { setHomeView("actions"); setDeleteCandidate(null); }}>Back</button></div>{drafts.length ? drafts.map((item) => <SummaryRow key={item.id} item={item} actionLabel="Delete" destructive onAction={() => setDeleteCandidate(item)} />) : <p className="py-6 text-sm text-zinc-500">No draft productions.</p>}</div> : null}
          {homeView === "completed" ? <div data-otg="production-v2-completed"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-xl font-black">Completed Productions</h2><button className={secondaryButton} onClick={() => setHomeView("actions")}>Back</button></div>{completed.length ? completed.map((item) => <SummaryRow key={item.id} item={item} actionLabel="Review" onAction={() => void openProduction(item)} />) : <p className="py-6 text-sm text-zinc-500">No completed productions.</p>}</div> : null}
        </div>
        {deleteCandidate ? <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="production-v2-delete-title"><div className="w-full max-w-md rounded-lg border border-red-300/25 bg-zinc-950 p-5 shadow-2xl"><h2 id="production-v2-delete-title" className="text-xl font-black text-white">Delete {deleteCandidate.name}?</h2><p className="mt-3 text-sm leading-6 text-zinc-400">This removes only this Production V2 record and its production-owned state.</p><div className="mt-6 flex justify-end gap-3"><button className={secondaryButton} onClick={() => setDeleteCandidate(null)} disabled={busy}>Cancel</button><button className={dangerButton} onClick={() => void confirmDelete()} disabled={busy}>{busy ? "Deleting..." : "Delete Production"}</button></div></div></div> : null}
      </section>
    );
  }

  if (!selectedScene || !currentPrompt) return null;

  const startingImageCandidates = [
    ...characters.map((item) => visualReference("character", item.id, item.name, item.defaultImage, item.characterCard)),
    ...backgrounds.map((item) => visualReference("background", item.id, item.name, item.masterImage)),
    ...assets.map((item) => visualReference("asset", item.id, item.name, item.defaultImage)),
  ];
  const ingredientCount = productionV2LtxVisualIngredientCount(selectedScene);
  const ingredientLimit = selectedScene.modelState.ltx.ingredients.visualIngredientLimit || LTX_V2_DEFAULT_INGREDIENT_LIMIT;
  const speakingCharacters = productionV2SpeakingCharacters(selectedScene);
  const speakerCount = speakingCharacters.length;
  const dialogueDurationWarning = productionV2DialogueDurationWarning(selectedScene);
  const usesDialogueOrder = selectedScene.generationMode === "h3-reference-to-video";
  const selectedSceneStatus = productionV2SceneCardStatus(selectedScene);

  return (
    <section data-otg="production-v2-storyboard" data-testid="production-v2-storyboard-root" data-production-model={selectedScene.model} data-production-stage={activeStage} className="production-v2-storyboard-theme mt-20 min-h-[calc(100vh-150px)] overflow-hidden rounded-lg border text-zinc-100 shadow-2xl sm:mt-0">
      <header className="border-b border-white/10 px-4 py-4 sm:px-6">
        <div data-otg="production-v2-top-actions" className="grid max-w-sm grid-cols-2 gap-2">
          <button className={`${secondaryButton} px-3`} onClick={() => void returnHome()}>Production Home</button>
          <button className={`${productionPrimaryButton} px-3`} disabled={busy || readOnly} onClick={() => void saveProduction()}>{busy ? "Saving..." : "Save Production"}</button>
        </div>
        <div className="mt-4 min-w-0">
          <p className="production-v2-accent-text text-xs font-black uppercase">Production</p>
          <h1 className="mt-1 break-words text-2xl font-black text-white">{production.name}</h1>
          <div className="mt-4"><StageNavigator stage={activeStage} onChange={changeStage} position="top" /></div>
          {activeStage === "storyboard" ? <div data-otg="production-v2-compact-switcher" className="mt-3 flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Production model" className="production-v2-model-switch inline-grid grid-cols-2 gap-1 rounded-lg border p-1">
              {(Object.keys(MODEL_LABELS) as ProductionV2Model[]).map((model) => (
                <button key={model} type="button" aria-pressed={selectedScene.model === model} disabled={readOnly} onClick={() => changeModel(model)} className="production-v2-model-button min-h-9 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-45">
                  {MODEL_LABELS[model]}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Production mode" className="production-v2-model-switch inline-flex gap-1 rounded-lg border p-1">
              {productionV2ModesForModel(selectedScene.model).map((mode) => (
                <button key={mode} type="button" aria-pressed={selectedScene.generationMode === mode} disabled={readOnly} onClick={() => changeMode(mode)} className="production-v2-model-button min-h-9 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-45">
                  {COMPACT_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div> : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Scene navigation">
          {production.scenes.map((scene) => <button key={scene.id} type="button" onClick={() => selectScene(scene.id)} aria-current={scene.id === selectedScene.id ? "step" : undefined} className={`h-10 min-w-10 rounded-lg border px-3 text-sm font-black ${scene.id === selectedScene.id ? "production-v2-control-active" : "border-white/10 bg-black/25 text-zinc-400"}`}>{scene.sceneNumber}</button>)}
          <button className={secondaryButton} disabled={busy || readOnly || production.scenes.length >= PRODUCTION_V2_MAX_SCENES} onClick={() => void addScene()}>+ Add Scene</button>
          <span className="ml-auto text-xs font-bold text-zinc-500">{production.scenes.length}/{PRODUCTION_V2_MAX_SCENES}</span>
        </div>
      </header>

      {activeStage !== "storyboard" && message ? <div role="status" className="mx-4 mt-4 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50 sm:mx-6">{message}</div> : null}

      {activeStage === "storyboard" ? <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
        {message ? <div role="status" className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">{message}</div> : null}
        {readOnly ? <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm font-bold text-amber-100">Completed production | Review only</div> : null}
        <SceneGrid scenes={savedScenes} activeSceneId={selectedScene.id} onSelect={selectScene} onOpen={setViewerSceneId} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.34fr)]">
          <div className="space-y-4">
            <div className="production-v2-accent-card rounded-lg border bg-zinc-950/70 p-4" data-otg="production-v2-scene-controls">
              <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase text-zinc-500">Scene {selectedScene.sceneNumber}</p><h2 className="mt-1 text-xl font-black text-white">Scene setup</h2></div><span className={`rounded-full px-3 py-1 text-xs font-black ${selectedSceneStatus === "Saved" || selectedSceneStatus === "Generated" ? "bg-emerald-300/15 text-emerald-200" : "bg-amber-300/15 text-amber-100"}`}>{selectedSceneStatus}</span></div>
            </div>

            <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4" data-otg="production-v2-what-happens">
              <NumberedHeading number="01" title="What should happen?" description="Write the scene naturally. The builder must preserve your requested action and story facts." />
              <label className="mt-4 block text-xs font-black uppercase text-zinc-500" htmlFor="production-v2-user-prompt">Scene description</label>
              <textarea id="production-v2-user-prompt" rows={5} value={currentPrompt.userPrompt} readOnly={readOnly} onChange={(event) => updateSelectedScene((scene) => updateProductionV2ScenePrompt(scene, { userPrompt: event.target.value }))} className={`${fieldClass} mt-2 resize-y`} />
            </div>

            <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4" data-otg="production-v2-look-controls">
              <NumberedHeading number="02" title="Choose the look" />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <SelectControl label="Visual style" value={selectedScene.promptOptions.visualStyle} options={H3_VISUAL_STYLE_OPTIONS} disabled={Boolean(readOnly)} onChange={(value) => updatePromptOption("visualStyle", value as ProductionV2PromptOptions["visualStyle"])} />
                <SelectControl label="Camera feel" value={selectedScene.promptOptions.cameraFeel} options={H3_CAMERA_FEEL_OPTIONS} disabled={Boolean(readOnly)} onChange={(value) => updatePromptOption("cameraFeel", value as ProductionV2PromptOptions["cameraFeel"])} />
                <SelectControl label="Shot flow" value={selectedScene.promptOptions.shotFlow} options={H3_SHOT_FLOW_OPTIONS} disabled={Boolean(readOnly)} onChange={(value) => updatePromptOption("shotFlow", value as ProductionV2PromptOptions["shotFlow"])} />
                <div><div className="text-xs font-black uppercase text-zinc-500">Quality</div><div aria-label="Quality" aria-readonly="true" className="mt-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-sm font-bold text-zinc-200"><span className="block">1080p final output</span><span className="mt-1 block text-[10px] font-normal text-zinc-500">Native H3 1024x576 + RTX VSR ULTRA</span></div></div>
              </div>
              <div className="mt-5"><div className="mb-2 text-xs font-black uppercase text-zinc-500">Video length</div><div className="grid grid-cols-3 gap-2">{PRODUCTION_V2_DURATION_OPTIONS.map((duration) => <SegmentButton key={duration} active={selectedScene.durationSeconds === duration} disabled={Boolean(readOnly)} onClick={() => updateSharedSceneInput((scene) => ({ ...scene, durationSeconds: duration as ProductionV2Duration }))}>{duration} sec</SegmentButton>)}</div></div>
              <div className="mt-5 max-w-xs"><div className="text-xs font-black uppercase text-zinc-500">Video shape</div><div aria-label="Video shape" aria-readonly="true" className="mt-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-sm font-bold text-zinc-200">16:9</div></div>
              <label className="mt-5 flex items-center gap-3 rounded-lg border border-white/10 bg-black/25 p-3 text-sm font-bold text-zinc-200"><input type="checkbox" checked={selectedScene.promptOptions.soundEnabled} disabled={readOnly} onChange={(event) => updatePromptOption("soundEnabled", event.target.checked)} className="production-v2-checkbox h-4 w-4" /><span><span className="block">Generate sound</span><span className="mt-1 block text-xs font-normal text-zinc-500">Dialogue, effects, and ambience</span></span></label>
              {selectedScene.model === "minimax-h3" ? (
                <div className="mt-5 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.04] p-4" data-otg="production-v2-h3-lora-controls">
                  <div className="text-xs font-black uppercase text-cyan-100">Qualified H3 LoRAs</div>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">Selected files are allowlisted and validated against the chosen backend before submission. Changing a LoRA makes the reviewed prompt stale.</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="block text-xs font-black uppercase text-zinc-500">
                      Visual style
                      <select aria-label="H3 visual style LoRA" value={selectedScene.modelState.h3.userLoras.visualStyle} disabled={readOnly} onChange={(event) => updateH3UserLoras((current) => ({ ...current, visualStyle: event.target.value as ProductionV2H3VisualStyleLora }))} className={`${fieldClass} mt-2 normal-case`}>
                        {H3_VISUAL_STYLE_LORA_OPTIONS.map((option) => <option key={option} value={option}>{H3_VISUAL_STYLE_LORA_LABELS[option]}</option>)}
                      </select>
                      <span className="mt-1 block text-[10px] font-normal normal-case text-zinc-500">Realism and Gurren are mutually exclusive. Strength 1.0.</span>
                    </label>
                    <label className="block text-xs font-black uppercase text-zinc-500">
                      Combat
                      <select aria-label="H3 Combat LoRA mode" value={selectedScene.modelState.h3.userLoras.combatMode} disabled={readOnly} onChange={(event) => updateH3UserLoras((current) => ({ ...current, combatMode: event.target.value as ProductionV2H3CombatLoraMode }))} className={`${fieldClass} mt-2 normal-case`}>
                        {H3_COMBAT_LORA_MODES.map((option) => <option key={option} value={option}>{H3_COMBAT_LORA_LABELS[option]}</option>)}
                      </select>
                      <span className="mt-1 block text-[10px] font-normal normal-case text-zinc-500">Independent of visual style. Provisional strength 0.7.</span>
                    </label>
                  </div>
                  <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.05] p-3">
                    <label className="flex items-start gap-3 text-sm font-bold text-amber-100"><input type="checkbox" aria-label="Enable experimental Motion Repair LoRA" checked={selectedScene.modelState.h3.userLoras.motionRepair.enabled} disabled={readOnly} onChange={(event) => updateH3UserLoras((current) => ({ ...current, motionRepair: { enabled: event.target.checked, useTrigger: event.target.checked ? current.motionRepair.useTrigger : false } }))} className="mt-0.5 h-4 w-4 accent-amber-300" /><span><span className="block">Motion Repair — Experimental</span><span className="mt-1 block text-xs font-normal text-zinc-500">Independent optional motion repair. Standalone qualified strength approximately 0.9.</span></span></label>
                    <label className="mt-3 flex items-center gap-3 text-xs font-bold text-zinc-300"><input type="checkbox" aria-label="Use Motion Repair trigger" checked={selectedScene.modelState.h3.userLoras.motionRepair.useTrigger} disabled={Boolean(readOnly || !selectedScene.modelState.h3.userLoras.motionRepair.enabled)} onChange={(event) => updateH3UserLoras((current) => ({ ...current, motionRepair: { ...current.motionRepair, useTrigger: event.target.checked } }))} className="h-4 w-4 accent-amber-300" /><span>Include optional trigger <code>bunny_crisp_motion</code></span></label>
                  </div>
                </div>
              ) : null}
              <details className="mt-4 rounded-lg border border-white/10 bg-black/20"><summary className="cursor-pointer px-4 py-3 text-sm font-bold text-zinc-300">+ Optional details</summary><div className="grid gap-4 border-t border-white/10 p-4 sm:grid-cols-2"><label className="text-xs font-black uppercase text-zinc-500">Sound or music direction<textarea aria-label="Sound or music direction" rows={3} value={selectedScene.promptOptions.soundDirection} readOnly={readOnly} onChange={(event) => updatePromptOption("soundDirection", event.target.value)} className={`${fieldClass} mt-2 resize-y normal-case`} /></label><label className="text-xs font-black uppercase text-zinc-500">Things to avoid<textarea aria-label="Things to avoid" rows={3} value={selectedScene.promptOptions.thingsToAvoid} readOnly={readOnly} onChange={(event) => updatePromptOption("thingsToAvoid", event.target.value)} className={`${fieldClass} mt-2 resize-y normal-case`} /></label></div></details>
            </div>

            <div className="production-v2-accent-card rounded-lg border bg-zinc-950/70 p-4" data-otg="production-v2-reference-controls">
              <NumberedHeading number="03" title="References" description={selectedScene.generationMode === "h3-image-to-video" ? "Choose exactly one starting image." : "Entity cards remain the source of truth; the resolver assigns ordered model inputs later."} />
              {selectedScene.generationMode === "h3-image-to-video" ? (
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-otg="h3-image-to-video-controls">
                  {startingImageCandidates.map((item) => {
                    const src = mediaUrl(item.displayImage || item.workflowImage);
                    const contain = item.sourceKind !== "background";
                    return <button key={item.id} type="button" onClick={() => setStartingImage(item)} disabled={readOnly} aria-pressed={selectedScene.modelState.h3.imageToVideo.startingImage?.id === item.id} aria-label={`Starting Image ${item.name}`} className={`overflow-hidden rounded-lg border text-left ${selectedScene.modelState.h3.imageToVideo.startingImage?.id === item.id ? "border-emerald-300 bg-emerald-300/10" : "border-white/10 bg-black/25"}`}><div className="aspect-[4/3] bg-zinc-900">{src ? <img src={src} alt={`${item.name} starting image`} className={`h-full w-full ${contain ? "object-contain p-2" : "object-cover"}`} /> : null}</div><div className="break-words px-3 py-2 text-xs font-bold">{item.name}</div></button>;
                  })}
                  {!startingImageCandidates.length ? <p className="col-span-full text-sm text-zinc-500">No saved default or master images.</p> : null}
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  <ReferenceAccordion label="Characters" count={selectedScene.selectedCharacters.length} expanded={expandedGroups.has("section:characters")} onToggle={() => toggleExpanded("section:characters")}>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{characters.map((item) => { const selected = selectedScene.selectedCharacters.some((entry) => entry.characterId === item.id); const full = selectedScene.model === "ltx-2.5" && ingredientCount >= ingredientLimit && !selected; const key = `character:${item.id}`; return <EntityCard key={key} entityType="Character" entityId={item.id} name={item.name} image={item.defaultImage} imageLabel="Default image" perspectives={item.perspectives} selected={selected} expanded={expandedGroups.has(key)} disabled={Boolean(readOnly || full)} onSelect={() => toggleCharacter(item)} onTogglePerspectives={() => toggleExpanded(key)} />; })}</div>{!characters.length ? <p className="text-sm text-zinc-500">No saved Characters.</p> : null}
                  </ReferenceAccordion>
                  <ReferenceAccordion label="Backgrounds" count={selectedScene.selectedBackground ? 1 : 0} expanded={expandedGroups.has("section:backgrounds")} onToggle={() => toggleExpanded("section:backgrounds")}>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{backgrounds.map((item) => { const selected = selectedScene.selectedBackground?.backgroundId === item.id; const full = selectedScene.model === "ltx-2.5" && ingredientCount >= ingredientLimit && !selected; const key = `background:${item.id}`; return <EntityCard key={key} entityType="Background" entityId={item.id} name={item.name} image={item.masterImage} imageLabel="Master image" perspectives={item.perspectives} selected={selected} expanded={expandedGroups.has(key)} disabled={Boolean(readOnly || full)} onSelect={() => selectBackground(item)} onTogglePerspectives={() => toggleExpanded(key)} />; })}</div>{!backgrounds.length ? <p className="text-sm text-zinc-500">No saved Backgrounds.</p> : null}
                  </ReferenceAccordion>
                  <ReferenceAccordion label="Assets" count={selectedScene.selectedAssets.length} expanded={expandedGroups.has("section:assets")} onToggle={() => toggleExpanded("section:assets")}>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{assets.map((item) => { const selected = selectedScene.selectedAssets.some((entry) => entry.assetId === item.id); const full = selectedScene.model === "ltx-2.5" && ingredientCount >= ingredientLimit && !selected; const key = `asset:${item.id}`; return <EntityCard key={key} entityType="Asset" entityId={item.id} name={item.name} image={item.defaultImage} imageLabel="Default image" perspectives={item.perspectives} selected={selected} expanded={expandedGroups.has(key)} disabled={Boolean(readOnly || full)} onSelect={() => toggleAsset(item)} onTogglePerspectives={() => toggleExpanded(key)} />; })}</div>{!assets.length ? <p className="text-sm text-zinc-500">No saved Assets.</p> : null}
                  </ReferenceAccordion>
                  {selectedScene.model === "ltx-2.5" ? <div className="rounded-lg border border-dashed border-emerald-300/25 bg-emerald-300/[0.05] p-4 text-center" data-otg="ltx-ingredients-sheet-placeholder"><div className="text-sm font-black text-emerald-100">Ingredients Sheet | {ingredientCount}/{ingredientLimit}</div><div className="mt-2 text-xs text-emerald-100/55">The later sheet composer will use the selected entity cards.</div></div> : null}
                </div>
              )}
            </div>

            {selectedScene.generationMode === "h3-reference-to-video" ? (
              <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4" data-otg="production-v2-who-speaks">
                <div className="flex items-start justify-between gap-3"><NumberedHeading number="04" title="Who speaks?" description="Choose up to three selected Characters. Their saved voices are mapped automatically." /><span className="shrink-0 text-xs font-black text-zinc-500">{speakerCount} / {PRODUCTION_V2_H3_MAX_SPEAKERS}</span></div>
                {selectedScene.selectedCharacters.length ? <div className="mt-5 space-y-3">{selectedScene.selectedCharacters.map((character) => <div key={character.characterId} className={`rounded-lg border p-3 ${character.speaking ? "border-emerald-300/35 bg-emerald-300/[0.07]" : "border-white/10 bg-black/25"}`}><label className={`flex items-center gap-3 ${character.voiceRef?.sourcePath ? "cursor-pointer" : "cursor-not-allowed opacity-55"}`}><input type="checkbox" checked={character.speaking} disabled={Boolean(readOnly || !character.voiceRef?.sourcePath)} onChange={() => toggleSpeaker(character.characterId)} aria-label={`${character.snapshotName} speaks`} className="h-4 w-4 accent-cyan-300" /><span className="min-w-0"><span className="block break-words text-sm font-black text-white">{character.snapshotName}</span><span className="mt-1 block text-xs text-zinc-500">{character.voiceRef?.sourcePath ? "Saved Voice" : "No saved voice"}</span></span></label></div>)}</div> : <p className="mt-5 text-sm text-zinc-500">Select Characters in References before assigning speakers.</p>}
              </div>
            ) : null}

            {usesDialogueOrder ? (
              <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4" data-otg="production-v2-dialogue-order">
                <NumberedHeading number="05" title="Dialogue Order" description="Set the exact conversation sequence. A Character may speak more than once using the same saved voice." />
                {selectedScene.dialogueTurns.length ? (
                  <div className="mt-5 space-y-3">
                    {selectedScene.dialogueTurns.map((turn, index) => (
                      <div key={turn.id} data-dialogue-turn-id={turn.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
                        <div className="grid gap-3 sm:grid-cols-[2.25rem_minmax(9rem,0.32fr)_minmax(0,1fr)] sm:items-start">
                          <div aria-label={`Dialogue turn ${index + 1}`} className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-zinc-950 text-sm font-black text-zinc-300">{index + 1}</div>
                          <label className="text-xs font-black uppercase text-zinc-500">Speaker<select aria-label={`Dialogue turn ${index + 1} speaker`} value={turn.speakerCharacterId} disabled={readOnly} onChange={(event) => updateDialogueTurn(turn.id, { speakerCharacterId: event.target.value })} className={`${fieldClass} mt-2 normal-case`}>{speakingCharacters.map((character) => <option key={character.characterId} value={character.characterId}>{character.snapshotName}</option>)}</select></label>
                          <label className="text-xs font-black uppercase text-zinc-500">Dialogue<textarea aria-label={`Dialogue turn ${index + 1} text`} rows={2} value={turn.text} readOnly={readOnly} onChange={(event) => updateDialogueTurn(turn.id, { text: event.target.value })} className={`${fieldClass} mt-2 resize-y normal-case`} /></label>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 sm:justify-end">
                          <button type="button" className={secondaryButton} disabled={Boolean(readOnly || index === 0)} onClick={() => moveDialogueTurn(turn.id, -1)} aria-label={`Move dialogue turn ${index + 1} up`}>Move Up</button>
                          <button type="button" className={secondaryButton} disabled={Boolean(readOnly || index === selectedScene.dialogueTurns.length - 1)} onClick={() => moveDialogueTurn(turn.id, 1)} aria-label={`Move dialogue turn ${index + 1} down`}>Move Down</button>
                          <button type="button" className={dangerButton} disabled={Boolean(readOnly)} onClick={() => deleteDialogueTurn(turn.id)} aria-label={`Delete dialogue turn ${index + 1}`}>Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="mt-5 text-sm text-zinc-500">No dialogue lines. The scene can remain nonverbal.</p>}
                <button type="button" className={`${secondaryButton} mt-4`} disabled={Boolean(readOnly || !speakingCharacters.length)} onClick={addDialogueTurn}>+ Add dialogue line</button>
                {dialogueDurationWarning ? <div data-otg="production-v2-dialogue-warning" className="mt-4 rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm leading-6 text-amber-100">{dialogueDurationWarning}</div> : null}
              </div>
            ) : null}

            <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4" data-otg="production-v2-build-prompt">
              <NumberedHeading number={usesDialogueOrder ? "06" : "04"} title="Build Scene Prompt" description={selectedScene.model === "minimax-h3" ? "Uses the local standalone-derived H3 prompt engine and validates duration before accepting output." : "Builds the LTX Ingredients scene instructions."} />
              <button type="button" className={`${productionPrimaryButton} mt-5`} disabled={Boolean(readOnly || busy || !currentPrompt.userPrompt.trim())} onClick={() => void buildPrompt()}>{busy ? "Building..." : "Build Scene Prompt"}</button>
            </div>

            <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4" data-otg="production-v2-prompt-controls">
              <div className="flex flex-wrap items-start justify-between gap-3"><NumberedHeading number={usesDialogueOrder ? "07" : "05"} title="Review Prompt" description="Locked references are application-owned. Only the Scene Prompt is editable." /><span className={`rounded-full px-3 py-1 text-xs font-black ${currentPrompt.reviewStatus === "reviewed" ? "bg-emerald-300/15 text-emerald-200" : currentPrompt.reviewStatus === "stale" ? "bg-red-300/15 text-red-200" : "bg-amber-300/15 text-amber-100"}`}>{REVIEW_LABELS[currentPrompt.reviewStatus]}</span></div>
              <div className="mt-5 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.04]" data-otg="production-v2-locked-references"><div className="flex items-center justify-between gap-3 border-b border-cyan-300/15 px-3 py-2"><span className="text-xs font-black uppercase text-cyan-100">Locked References</span><span aria-label="Locked" className="text-xs font-black text-cyan-200">LOCKED</span></div><pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 text-xs leading-5 text-cyan-50/75">{currentPrompt.lockedReferenceContext || "No separate locked H3 reference block has been built for this scene."}</pre></div>
              <label className="mt-5 block text-xs font-black uppercase text-zinc-500" htmlFor="production-v2-scene-prompt">Scene Prompt</label>
              <textarea id="production-v2-scene-prompt" rows={14} value={currentPrompt.scenePrompt} readOnly={readOnly} onChange={(event) => updateSelectedScene((scene) => updateProductionV2ScenePromptText(scene, event.target.value))} placeholder="Build the scene prompt to review and edit the cinematic instructions." className={`${fieldClass} mt-2 resize-y font-mono text-xs leading-5`} />
              <label className="mt-5 block text-xs font-black uppercase text-zinc-500" htmlFor="production-v2-final-prompt">Exact Final Prompt</label>
              <textarea id="production-v2-final-prompt" rows={14} value={currentPrompt.finalPrompt} readOnly aria-readonly="true" placeholder="Locked References and Scene Prompt will appear here exactly as H3 receives them." className={`${fieldClass} mt-2 resize-y font-mono text-xs leading-5 text-zinc-400`} />
              <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" className={secondaryButton} disabled={Boolean(readOnly || currentPrompt.reviewStatus === "stale" || !currentPrompt.scenePrompt.trim())} onClick={reviewFinalPrompt}>{currentPrompt.reviewStatus === "reviewed" ? "Final Prompt Reviewed" : "Review Final Prompt"}</button><span className="text-xs text-zinc-500">Editing the Scene Prompt requires another review.</span></div>
            </div>

            <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4" data-otg="production-v2-generate-step">
              <NumberedHeading number={usesDialogueOrder ? "08" : "06"} title="Generate" description={generationJob?.statusMessage || readiness.reason} />
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" className={productionPrimaryButton} disabled={!readiness.ok || readOnly || generationSubmitting || videoRetrySubmitting || generationActive || selectedScene.model !== "minimax-h3"} onClick={() => void generateVideo()}>{generationSubmitting ? "Submitting..." : generationActive ? generationJob?.statusMessage || "Generating..." : "Generate"}</button>
                <button type="button" className={secondaryButton} disabled={videoRefreshBusy} onClick={() => void refreshVideoState()}>{videoRefreshBusy ? "Refreshing..." : "Refresh"}</button>
                {currentPrompt.reviewStatus === "reviewed" ? (
                  <button
                    type="button"
                    className={secondaryButton}
                    disabled={!hasPriorVideoAttempt || !readiness.ok || readOnly || videoRetrySubmitting || generationSubmitting || generationActive || selectedScene.model !== "minimax-h3"}
                    onClick={() => void retryVideo()}
                    title={hasPriorVideoAttempt ? "Reuse the exact reviewed prompt in a new stochastic generation job." : "Retry becomes available after the first generation attempt."}
                    data-otg="production-v2-video-retry"
                  >
                    {videoRetrySubmitting ? "Retrying..." : "Retry"}
                  </button>
                ) : null}
              </div>
              {generationJob ? <div className="mt-3 text-xs text-zinc-500" data-otg="production-v2-generation-provenance">Job {generationJob.id}{generationJob.promptId ? ` · Prompt ${generationJob.promptId}` : ""}{generationJob.retryOfJobId ? ` · Retry of ${generationJob.retryOfJobId}` : ""}</div> : null}
              {generationJob?.error ? <div className="mt-4 rounded-lg border border-red-300/25 bg-red-300/10 px-3 py-2 text-sm text-red-100" role="alert">{generationJob.error}</div> : null}
              {storyboardVideoSrc ? <video key={storyboardVideoSrc} className="mt-5 aspect-video w-full rounded-lg bg-black" controls playsInline preload="metadata" src={storyboardVideoSrc} data-otg="production-v2-generated-video" /> : null}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4"><div className="text-xs font-black uppercase text-zinc-500">Scene summary</div><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-zinc-500">Model</dt><dd className="font-bold text-white">{MODEL_LABELS[selectedScene.model]}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500">Mode</dt><dd className="text-right font-bold text-white">{MODE_LABELS[selectedScene.generationMode]}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500">Duration</dt><dd className="font-bold text-white">{selectedScene.durationSeconds}s</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500">Shape</dt><dd className="font-bold text-white">{selectedScene.promptOptions.aspectRatio}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500">Characters</dt><dd className="font-bold text-white">{selectedScene.selectedCharacters.length}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500">Background</dt><dd className="max-w-32 break-words text-right font-bold text-white">{selectedScene.selectedBackground?.snapshotName || "None"}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500">Assets</dt><dd className="font-bold text-white">{selectedScene.selectedAssets.length}</dd></div></dl></div>
            <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4"><div className="text-xs font-black uppercase text-zinc-500">Reference manifest</div><div className={`mt-3 text-sm font-bold ${selectedScene.referencePlan.status === "planned" ? "text-emerald-200" : "text-amber-100"}`}>{selectedScene.referencePlan.status === "planned" ? "Resolved" : "Pending build"}</div><div className="mt-2 text-xs leading-5 text-zinc-500">{selectedScene.referencePlan.modelFacingReferences.length} ordered visual references. {selectedScene.referencePlan.resolvedVoiceReferences.length} Character voices mapped automatically.</div></div>
            <button type="button" className={`${productionPrimaryButton} w-full`} disabled={busy || readOnly} onClick={() => void saveScene()}>{busy ? "Saving..." : "Save Scene"}</button>
          </aside>
        </div>
      </div> : activeStage === "visual-studios" ? (
        <StudioShell kind="visual" production={production} scene={selectedScene} savedScenes={savedScenes} readOnly={readOnly} generationJob={generationJob} onSelectScene={selectScene} onOpenScene={setViewerSceneId} onVersionChange={changeStudioVersion} onProductionChange={setProduction} onPersist={() => saveProduction(production, "Visual Studios source saved.")} onH3Edit={submitH3VisualEdit} onMessage={setMessage} />
      ) : activeStage === "audio-studios" ? (
        <StudioShell kind="audio" production={production} scene={selectedScene} savedScenes={savedScenes} readOnly={readOnly} generationJob={generationJob} onSelectScene={selectScene} onOpenScene={setViewerSceneId} onVersionChange={changeStudioVersion} onProductionChange={setProduction} onPersist={() => saveProduction(production, "Audio Studios source saved.")} onH3Edit={submitH3VisualEdit} onMessage={setMessage} />
      ) : (
        <AssemblyShell production={production} savedScenes={savedScenes} readOnly={readOnly} onSelectScene={selectScene} onOpenScene={setViewerSceneId} onMoveClip={moveAssemblyClip} onVersionChange={changeAssemblyClipVersion} onAssemblyChange={changeAssembly} onGenerateMusic={generateAssemblyMusic} onRender={renderAssembly} onApprove={approveFinalProduction} />
      )}
      <div className="border-t border-white/10 px-4 py-5 sm:px-6"><StageNavigator stage={activeStage} onChange={changeStage} position="bottom" /></div>
      {viewerScene ? <SceneViewer scene={viewerScene} onClose={() => setViewerSceneId(null)} /> : null}
    </section>
  );
}
