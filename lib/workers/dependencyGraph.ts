import { getWorkerCatalogEntry } from "@/lib/workers/workerCatalog";

export type VoiceVideoPipelineStage =
  | "character_selected"
  | "voice_method_selected"
  | "tts_service_ready"
  | "voice_sample_generated"
  | "voice_sample_approved"
  | "dataset_ready"
  | "applio_ready"
  | "ltx_preview_ready";

export type DependencyValidationInput = {
  workerId?: string;
  completedStages?: VoiceVideoPipelineStage[];
  requestedStage?: VoiceVideoPipelineStage;
};

export type DependencyValidationResult =
  | { ok: true; missing: string[] }
  | { ok: false; missing: string[]; error: string };

const REQUIRED_STAGE_ORDER: VoiceVideoPipelineStage[] = [
  "character_selected",
  "voice_method_selected",
  "tts_service_ready",
  "voice_sample_generated",
  "voice_sample_approved",
  "dataset_ready",
  "applio_ready",
  "ltx_preview_ready",
];

const WORKER_STAGE_REQUIREMENTS: Record<string, VoiceVideoPipelineStage[]> = {
  "qwen3-tts": ["character_selected", "voice_method_selected"],
  xtts: ["character_selected", "voice_method_selected"],
  cozyvoice: ["character_selected", "voice_method_selected"],
  "voice-dataset": ["character_selected", "voice_sample_approved"],
  applio: ["character_selected", "voice_sample_approved", "dataset_ready"],
  "comfy-3090-sage-video": ["character_selected", "voice_sample_approved"],
  "voice-ltx": ["character_selected", "voice_sample_approved", "applio_ready"],
};

export function requiredStagesBefore(stage: VoiceVideoPipelineStage): VoiceVideoPipelineStage[] {
  const index = REQUIRED_STAGE_ORDER.indexOf(stage);
  return index <= 0 ? [] : REQUIRED_STAGE_ORDER.slice(0, index);
}

export function getWorkerDependencies(workerId: string): string[] {
  return [...(getWorkerCatalogEntry(workerId)?.dependencies || [])];
}

export function getWorkerRequiredStages(workerId: string): VoiceVideoPipelineStage[] {
  return [...(WORKER_STAGE_REQUIREMENTS[workerId] || [])];
}

export function validateWorkerDependencyState(input: DependencyValidationInput): DependencyValidationResult {
  const completed = new Set(input.completedStages || []);
  const required = [
    ...(input.workerId ? getWorkerRequiredStages(input.workerId) : []),
    ...(input.requestedStage ? requiredStagesBefore(input.requestedStage) : []),
  ];
  const missing = Array.from(new Set(required.filter((stage) => !completed.has(stage))));
  if (missing.length) {
    return {
      ok: false,
      missing,
      error: "Worker lifecycle dependencies are not satisfied.",
    };
  }
  return { ok: true, missing: [] };
}

export function workerRequiresWindows3090(workerId: string): boolean {
  const entry = getWorkerCatalogEntry(workerId);
  return Boolean(entry?.resources.includes("gpu:windows-3090"));
}

export function assertQwenImageDoesNotUseWindows3090(workerId: string, workloadKind: string): { ok: true } | { ok: false; error: string } {
  if (workloadKind === "qwen-image" && workerRequiresWindows3090(workerId)) {
    return { ok: false, error: "Qwen image jobs must not route to the Windows RTX 3090 video lane." };
  }
  return { ok: true };
}
