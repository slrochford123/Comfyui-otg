/** Public, path-free plan contract. Both controllers feed the existing H3 engine. */
import { assertFastH3StudioLoras } from "@/lib/h3FastLora";
import { h3RegisteredLoraStrengthBounds } from "@/lib/h3LoraGuidance";
import { isH3OmniRefMode } from "@/lib/h3OmniRef";
export const H3_STUDIO_VERSION = "h3-studio-v1";
export const H3_STUDIO_SIZES = { "0.2": [608, 352], "0.6": [1056, 608], "1": [1344, 768] } as const;
export const H3_STUDIO_WORKFLOWS = [
  { id: "native-t2v", label: "Text to Video", mode: "h3-text-to-video", family: "FL2VA", media: "none" },
  { id: "native-i2v", label: "First / Last Frame", mode: "h3-image-to-video", family: "FL2VA", media: "image" },
  { id: "native-r2v", label: "Reference to Video", mode: "h3-reference-to-video", family: "Ref2VA", media: "reference" },
  { id: "reference-edit", label: "Reference-guided Video Edit", mode: "h3-reference-to-video", family: "Ref2VA", media: "video" },
] as const;
export type H3StudioWorkflowId = typeof H3_STUDIO_WORKFLOWS[number]["id"];
export const H3_STUDIO_PROFILES = {
  native: { sampler: "res_multistep", scheduler: "simple", steps: 20 },
  "ref2va-8step": { sampler: "euler", scheduler: "simple", steps: 8 },
  "fl2va-8step": { sampler: "res_multistep", scheduler: "simple", steps: 8 },
} as const;
export type H3StudioPlan = {
  /** Omitted only by legacy saved plans; normalized to RTX 3090. */
  backend?: "rtx3090" | "rtx5060ti";
  version: typeof H3_STUDIO_VERSION;
  workflowId: H3StudioWorkflowId;
  checkpoint: "standard" | "singularity" | "fasth3" | "selflift";
  profile: "native" | "ref2va-8step" | "fl2va-8step";
  quality: keyof typeof H3_STUDIO_SIZES;
  orientation: "landscape" | "portrait";
  durationSeconds: number;
  fps: 24;
  seed: number;
  prompt: string;
  originalPrompt: string;
  loras: Array<{ id: string; strength: number; enabled: boolean }>;
  attention: "project-sla" | "dense" | "vsa";
  audio: "generated" | "original" | "mute";
  combatEnabled: boolean;
  camera: "none" | "static" | "pan" | "dolly" | "tracking";
  motion: "none" | "subtle" | "dynamic";
  sampler: "res_multistep" | "euler";
  scheduler: "simple";
  steps: 20 | 8;
};
export const DEFAULT_H3_STUDIO_PLAN: H3StudioPlan = {
  backend: "rtx3090",
  version: H3_STUDIO_VERSION, workflowId: "native-t2v", checkpoint: "standard", profile: "native",
  quality: "0.6", orientation: "landscape", durationSeconds: 5, fps: 24, seed: 424242,
  prompt: "", originalPrompt: "", loras: [], attention: "project-sla", audio: "generated", combatEnabled: false,
  camera: "none", motion: "none", ...H3_STUDIO_PROFILES.native,
};
export function studioDimensions(plan: Pick<H3StudioPlan, "quality" | "orientation">) {
  const pair = H3_STUDIO_SIZES[plan.quality];
  if (!pair) throw new Error("Unsupported H3 quality.");
  return plan.orientation === "portrait" ? { width: pair[1], height: pair[0] } : { width: pair[0], height: pair[1] };
}
export function studioFrames(seconds: number) { return Math.ceil((seconds * 24 - 5) / 17) * 17 + 5; }
/** Choose an existing template only. Actual reference-edit length is compiled separately. */
export function studioTemplateDuration(seconds: number): 5 | 10 { return seconds <= 5 ? 5 : 10; }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("An H3 plan object is required.");
  return value as Record<string, unknown>;
}
/** Reject unknown keys rather than accepting AI-supplied paths, graphs or prices. */
export function parseH3StudioPlan(value: unknown): H3StudioPlan {
  const raw = object(value);
  // v1 saved plans predate these controls. Only the added fields get defaults.
  const profileDefaults = H3_STUDIO_PROFILES[raw.profile as keyof typeof H3_STUDIO_PROFILES] || H3_STUDIO_PROFILES.native;
  const p: Record<string, unknown> = { backend: "rtx3090", camera: "none", motion: "none", ...profileDefaults, ...raw };
  if (Object.keys(p).some(key => !Object.hasOwn(DEFAULT_H3_STUDIO_PLAN, key))) throw new Error("Unknown H3 plan field.");
  if (Object.keys(DEFAULT_H3_STUDIO_PLAN).some(key => !Object.hasOwn(p, key))) throw new Error("Incomplete H3 plan.");
  const enums: Record<string, readonly unknown[]> = {
    backend: ["rtx3090", "rtx5060ti"],
    version: [H3_STUDIO_VERSION], workflowId: H3_STUDIO_WORKFLOWS.map(w => w.id), checkpoint: ["standard", "singularity", "fasth3", "selflift"],
    profile: Object.keys(H3_STUDIO_PROFILES), quality: Object.keys(H3_STUDIO_SIZES), orientation: ["landscape", "portrait"],
    fps: [24], attention: ["project-sla", "dense", "vsa"], audio: ["generated", "original", "mute"],
    camera: ["none", "static", "pan", "dolly", "tracking"], motion: ["none", "subtle", "dynamic"],
    sampler: ["res_multistep", "euler"], scheduler: ["simple"], steps: [20, 8],
  };
  for (const [key, values] of Object.entries(enums)) if (!values.includes(p[key])) throw new Error(`Unsupported H3 ${key}.`);
  if (!Number.isSafeInteger(p.seed) || Number(p.seed) < 0 || typeof p.combatEnabled !== "boolean") throw new Error("Invalid H3 seed or Combat state.");
  for (const key of ["prompt", "originalPrompt"]) if (typeof p[key] !== "string" || !(p[key] as string).trim() || (p[key] as string).length > 4000) throw new Error("Describe the video in 1–4000 characters.");
  if (!Array.isArray(p.loras) || p.loras.length > 3) throw new Error("At most three qualified optional LoRAs may be stacked.");
  const ids = new Set<string>();
  for (const entry of p.loras) {
    const l = object(entry);
    if (Object.keys(l).sort().join() !== "enabled,id,strength" || typeof l.id !== "string" || !/^civitai-\d+-\d+$/.test(l.id) || ids.has(l.id)
      || typeof l.enabled !== "boolean" || typeof l.strength !== "number" || !Number.isFinite(l.strength)
      || l.strength < h3RegisteredLoraStrengthBounds(l.id).min || l.strength > h3RegisteredLoraStrengthBounds(l.id).max) throw new Error("Invalid, duplicate or unapproved LoRA selection.");
    ids.add(l.id);
  }
  const plan = structuredClone(p) as H3StudioPlan;
  if (isH3OmniRefMode(plan.checkpoint)) {
    if (plan.workflowId !== "native-r2v" || plan.profile !== "ref2va-8step" || plan.attention !== "vsa"
      || plan.steps !== 8 || plan.sampler !== "euler" || plan.combatEnabled) {
      throw new Error("FastH3 / SelfLift requires its dedicated Reference configuration: eight Euler steps, VSA, no automatic legacy modifiers.");
    }
    assertFastH3StudioLoras(plan.loras);
  } else if (plan.attention === "vsa") throw new Error("VSA requires an explicit FastH3 model selection.");
  if (!Number.isFinite(plan.durationSeconds) || (plan.workflowId === "reference-edit" ? plan.durationSeconds < 2 || plan.durationSeconds > 10 : ![5, 10].includes(plan.durationSeconds))) throw new Error("Unsupported H3 durationSeconds.");
  const workflow = H3_STUDIO_WORKFLOWS.find(w => w.id === plan.workflowId)!;
  if (plan.profile === "ref2va-8step" && workflow.family !== "Ref2VA") throw new Error("Ref2VA 8-step cannot be applied to FL2VA.");
  if (plan.profile === "fl2va-8step" && workflow.family !== "FL2VA") throw new Error("FL2VA 8-step cannot be applied to Ref2VA.");
  if (plan.checkpoint === "singularity" && workflow.family !== "Ref2VA") throw new Error("This Singularity checkpoint is Ref2VA only.");
  if (plan.combatEnabled && plan.checkpoint !== "singularity") throw new Error("Combat V2 requires the qualified Singularity path.");
  if (plan.audio === "original" && plan.workflowId !== "reference-edit") throw new Error("Original audio requires a source-video edit.");
  const registered = H3_STUDIO_PROFILES[plan.profile];
  if (plan.sampler !== registered.sampler || plan.scheduler !== registered.scheduler || plan.steps !== registered.steps) throw new Error("Sampler, scheduler and steps must match the registered profile.");
  return plan;
}
export function studioBackend(plan: Pick<H3StudioPlan, "backend">) { return plan.backend ?? "rtx3090"; }
export function studioGpuPattern(backend: "rtx3090" | "rtx5060ti") { return backend === "rtx3090" ? /RTX\s*3090/i : /RTX\s*5060\s*Ti/i; }
export type H3StudioReconcileCatalogItem = { id: string; family: "FL2VA" | "Ref2VA" | "both" | null;
  strength: { min: number; max: number } | null; blockedReasons?: string[] };
/** A controller patch is reconciled once, before strict parsing/preview. Never mutates either input. */
export function reconcileH3StudioPlan(plan: H3StudioPlan, patch: Partial<H3StudioPlan>, catalog?: readonly H3StudioReconcileCatalogItem[]): H3StudioPlan {
  const registered: Record<string, readonly unknown[]> = { checkpoint: ["standard", "singularity", "fasth3", "selflift"], profile: Object.keys(H3_STUDIO_PROFILES),
    sampler: ["res_multistep", "euler"], scheduler: ["simple"], steps: [8, 20] };
  for (const [key, values] of Object.entries(registered)) if (Object.hasOwn(patch, key) && !values.includes((patch as Record<string, unknown>)[key])) throw new Error(`Unsupported H3 ${key}.`);
  const next = { ...plan, ...object(patch) } as H3StudioPlan;
  const workflow = H3_STUDIO_WORKFLOWS.find(w => w.id === next.workflowId);
  if (!workflow) throw new Error("Unsupported H3 workflowId.");
  if (workflow.id !== "reference-edit" && ![5, 10].includes(next.durationSeconds)) next.durationSeconds = studioTemplateDuration(next.durationSeconds);
  if (isH3OmniRefMode(patch.checkpoint) && next.workflowId !== "native-r2v") throw new Error("FastH3 / SelfLift OmniRef is supported only for Reference-to-Video.");
  if (isH3OmniRefMode(next.checkpoint) && next.workflowId !== "native-r2v") next.checkpoint = "standard";
  if (!isH3OmniRefMode(next.checkpoint) && next.attention === "vsa") next.attention = "project-sla";
  if (workflow.family !== "Ref2VA") {
    next.checkpoint = "standard";
    if (next.profile === "ref2va-8step") next.profile = "native";
  }
  if (workflow.family === "Ref2VA" && next.profile === "fl2va-8step") next.profile = "native";
  if (next.checkpoint !== "singularity") next.combatEnabled = false;
  if (next.workflowId !== "reference-edit" && next.audio === "original") next.audio = "generated";
  if (next.profile !== plan.profile || patch.profile !== undefined || patch.workflowId !== undefined || patch.checkpoint !== undefined) {
    const registered = H3_STUDIO_PROFILES[next.profile];
    if (!registered) throw new Error("Unsupported H3 profile.");
    Object.assign(next, registered);
  }
  if (catalog) next.loras = next.loras.filter(selection => {
    const item = catalog.find(entry => entry.id === selection.id);
    return !!item && (item.family === "both" || item.family === workflow.family) && !!item.strength
      && selection.strength >= item.strength.min && selection.strength <= item.strength.max
      && !item.blockedReasons?.length;
  });
  if (isH3OmniRefMode(next.checkpoint)) Object.assign(next, {
    profile: "ref2va-8step", ...H3_STUDIO_PROFILES["ref2va-8step"], attention: "vsa", combatEnabled: false,
  });
  return parseH3StudioPlan(next);
}
export function makeLocalH3Plan(description: string, media: { first: boolean; images: number; videos: number; audios: number }, base: H3StudioPlan): H3StudioPlan {
  if (!media.videos && /\b(edit|restyle|modify|change)\b.{0,40}\b(this|the|my|source)\b.{0,20}\b(video|clip|footage)\b/i.test(description)) throw new Error("Choose the source video before planning a video edit.");
  const workflowId = media.videos ? "reference-edit" : media.first ? "native-i2v" : media.images || media.audios ? "native-r2v" : "native-t2v";
  return reconcileH3StudioPlan(base, { workflowId, prompt: description, originalPrompt: description });
}
/** Auto has one fixed execution standard, independent of saved/manual/AI settings. */
export function automaticH3Plan(plan: H3StudioPlan, workflowId = plan.workflowId) {
  const ref = H3_STUDIO_WORKFLOWS.find(w => w.id === workflowId)?.family === "Ref2VA";
  return reconcileH3StudioPlan(plan, { workflowId, attention: isH3OmniRefMode(plan.checkpoint) && workflowId === "native-r2v" ? "vsa" : "project-sla", profile: ref ? "ref2va-8step" : "fl2va-8step" });
}
