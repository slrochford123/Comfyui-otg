import {
  CHARACTER_ANIMATION_PREVIEW_ACTIONS,
  CHARACTER_VOICE_PIPELINE_ACTIONS,
  PRODUCTION_AUDIO_STUDIO_ACTIONS,
  type CharacterAnimationPreviewAction,
  type CharacterVoicePipelineAction,
  type ProductionAudioStudioAction,
  type QueuedContractJobType,
} from "@/lib/jobs/voicePipelineJobs";

export const OTG_WORKER_JOB_TYPES = [
  "character_voice_pipeline",
  "production_audio_studio",
  "character_animation_preview",
] as const satisfies readonly QueuedContractJobType[];

export const OTG_WORKER_ONLY_FEATURE_AREAS = [
  "ai_assistance_model_calls",
  "describe_picture",
  "enhance_prompt_model_calls",
  "scene_creator_model_calls",
  "ask_ai_model_calls",
  "image_generation",
  "video_generation",
  "animation_generation",
  "first_to_last_image",
  "angles_camera_angles",
  "three_d_models",
  "textures",
  "production_generation",
  "storyboard_generation",
  "visual_edit",
  "audio_studio_processing",
  "assemble_processing",
  "character_card_generation",
  "voice_design",
  "voice_effects",
  "training_dataset_generation",
  "applio_training",
  "trained_voice_preview",
  "edit_video",
  "stitch_video",
  "audio_edit",
  "voice_dubbing",
  "extract_audio",
  "remove_music",
] as const;

export type OtgWorkerJobType = (typeof OTG_WORKER_JOB_TYPES)[number];
export type OtgWorkerAction = CharacterVoicePipelineAction | ProductionAudioStudioAction | CharacterAnimationPreviewAction;

export type OtgWorkerJobRoute = {
  jobType: OtgWorkerJobType;
  action: OtgWorkerAction;
  workerOnly: true;
  adapterHint: string;
  description: string;
};

export const OTG_WORKER_JOB_ROUTES: readonly OtgWorkerJobRoute[] = [
  {
    jobType: "character_voice_pipeline",
    action: "generate_training_dataset",
    workerOnly: true,
    adapterHint: "windows.indextts2_dataset",
    description: "Generate the 200-clip same-speaker IndexTTS2 voice pack from the approved reference voice.",
  },
  {
    jobType: "character_voice_pipeline",
    action: "start_applio_training",
    workerOnly: true,
    adapterHint: "windows.applio_training",
    description: "Train the Applio voice model from a completed real voice pack.",
  },
  {
    jobType: "character_voice_pipeline",
    action: "test_trained_voice",
    workerOnly: true,
    adapterHint: "windows.applio_inference",
    description: "Run trained Applio model inference for Voice Lab playback.",
  },
  {
    jobType: "character_voice_pipeline",
    action: "apply_voice_fx",
    workerOnly: true,
    adapterHint: "windows.voice_fx",
    description: "Apply deterministic Voice FX on the Windows worker.",
  },
  {
    jobType: "character_voice_pipeline",
    action: "create_voice_sample",
    workerOnly: true,
    adapterHint: "windows.voice_design",
    description: "Create the approved base character voice with Qwen3-TTS or CosyVoice on the Windows worker.",
  },
  {
    jobType: "character_animation_preview",
    action: "animate_preview",
    workerOnly: true,
    adapterHint: "windows.character_animate_preview",
    description: "Render Animate Me preview video on the Windows worker.",
  },
  ...PRODUCTION_AUDIO_STUDIO_ACTIONS.map((action) => ({
    jobType: "production_audio_studio" as const,
    action,
    workerOnly: true as const,
    adapterHint: "windows.production_audio",
    description: "Run production audio/video processing on the Windows worker.",
  })),
] as const;

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function includesString<T extends readonly string[]>(items: T, value: unknown): value is T[number] {
  return typeof value === "string" && (items as readonly string[]).includes(value);
}

export function normalizeOtgWorkerJobType(value: unknown): OtgWorkerJobType | null {
  return includesString(OTG_WORKER_JOB_TYPES, cleanString(value)) ? cleanString(value) as OtgWorkerJobType : null;
}

export function normalizeOtgWorkerAction(jobType: OtgWorkerJobType, value: unknown): OtgWorkerAction | null {
  const action = cleanString(value);
  if (jobType === "character_voice_pipeline" && includesString(CHARACTER_VOICE_PIPELINE_ACTIONS, action)) {
    return action;
  }
  if (jobType === "production_audio_studio" && includesString(PRODUCTION_AUDIO_STUDIO_ACTIONS, action)) {
    return action;
  }
  if (jobType === "character_animation_preview" && includesString(CHARACTER_ANIMATION_PREVIEW_ACTIONS, action)) {
    return action;
  }
  return null;
}

export function getOtgWorkerJobRoute(jobType: OtgWorkerJobType, action: OtgWorkerAction): OtgWorkerJobRoute | null {
  return OTG_WORKER_JOB_ROUTES.find((route) => route.jobType === jobType && route.action === action) || null;
}

export function isOtgWorkerOnlyJob(jobType: OtgWorkerJobType, action: OtgWorkerAction): boolean {
  return !!getOtgWorkerJobRoute(jobType, action);
}
