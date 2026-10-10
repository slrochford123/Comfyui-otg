import {
  H3_ORIENTATION_OPTIONS,
  H3_PRODUCTION_DURATION_OPTIONS,
  H3_QUALITY_OPTIONS,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import { appendProtectedDialogueBlock, detectProtectedDialogue } from "@/lib/promptDialogue";
import {
  h3CreativeDirectionLines,
  type H3CreativeDirectionInput,
} from "@/lib/h3CreativeDirection";

export type H3RealismReferenceKind = "image" | "video" | "audio";

export type H3RealismReferenceInput = {
  kind: H3RealismReferenceKind;
  name?: string;
  description?: string;
  durationSeconds?: number | null;
};

export type H3RealismSpeedLoraId =
  | "minimax_h3_ref2v_turbo_4step_v0.1"
  | "ref2v_turbo_8step_v1.0_768p"
  | "turbo_v4_step600_ema";

export type H3RealismPresetId =
  | "balanced"
  | "max-realism"
  | "max-intelligence"
  | "speed-draft";

export type H3RealismLoraSettingsInput = {
  preset?: unknown;
  speedLora?: unknown;
  speedLoras?: unknown;
  peopleRealismEnabled?: unknown;
  speedStrength?: unknown;
  peopleStrength?: unknown;
  steps?: unknown;
};

export type H3RealismNormalizedLoras = {
  preset: H3RealismPresetId;
  speedLora: H3RealismSpeedLoraId;
  peopleRealismEnabled: boolean;
  speedStrength: number;
  peopleStrength: number;
  steps: number;
  loras: Array<{
    id: H3RealismSpeedLoraId | "minimax-h3-people";
    filename: string;
    strength: number;
  }>;
};

export type H3RealismRequestInput = {
  prompt?: unknown;
  quality?: unknown;
  orientation?: unknown;
  durationSeconds?: unknown;
  references?: unknown;
  loraSettings?: H3RealismLoraSettingsInput;
};

export type H3RealismCompileInput = {
  prompt: string;
  durationSeconds?: H3ProductionDuration;
  orientation?: H3Orientation;
  references?: H3RealismReferenceInput[];
  loras?: H3RealismNormalizedLoras;
  creative?: H3CreativeDirectionInput;
};

export const H3_REALISM_LIMITS = {
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  maxCombinedReferences: 12,
  minVideoSeconds: 2,
  maxVideoSeconds: 15,
  maxTotalVideoSeconds: 15,
  maxTotalAudioSeconds: 15,
} as const;

export const H3_REALISM_PEOPLE_TRIGGER = "r34l1sm";

export const H3_REALISM_SPEED_LORAS: Record<
  H3RealismSpeedLoraId,
  {
    id: H3RealismSpeedLoraId;
    label: string;
    filename: string;
    defaultStrength: number;
    defaultSteps: number;
  }
> = {
  "minimax_h3_ref2v_turbo_4step_v0.1": {
    id: "minimax_h3_ref2v_turbo_4step_v0.1",
    label: "Speed Draft 4-step",
    filename: "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
    defaultStrength: 1,
    defaultSteps: 6,
  },
  "ref2v_turbo_8step_v1.0_768p": {
    id: "ref2v_turbo_8step_v1.0_768p",
    label: "Reference 8-step",
    filename: "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
    defaultStrength: 1,
    defaultSteps: 8,
  },
  turbo_v4_step600_ema: {
    id: "turbo_v4_step600_ema",
    label: "EMA-600 skin realism",
    filename: "minimax_h3_turbo_v4_step600_ema_comfyui.safetensors",
    defaultStrength: 1,
    defaultSteps: 8,
  },
};

export const H3_REALISM_PEOPLE_LORA = {
  id: "minimax-h3-people" as const,
  label: "People Realism",
  // The supplied workflow names this as minimax-h3-people.safetensors.
  // The 3090 TEST backend currently exposes the same Realism/people LoRA under
  // this installed filename, so the adapter uses the runnable local asset
  // without changing the copied workflow template.
  filename: "h3-realism-people-t2v-i2v-r2v.safetensors",
  defaultStrength: 0.8,
};

export const H3_REALISM_PRESETS: Record<
  H3RealismPresetId,
  {
    id: H3RealismPresetId;
    label: string;
    speedLora: H3RealismSpeedLoraId;
    peopleRealismEnabled: boolean;
    steps: number;
  }
> = {
  balanced: {
    id: "balanced",
    label: "Balanced",
    speedLora: "ref2v_turbo_8step_v1.0_768p",
    peopleRealismEnabled: true,
    steps: 8,
  },
  "max-realism": {
    id: "max-realism",
    label: "Max Realism",
    speedLora: "turbo_v4_step600_ema",
    peopleRealismEnabled: true,
    steps: 8,
  },
  "max-intelligence": {
    id: "max-intelligence",
    label: "Max Intelligence",
    speedLora: "ref2v_turbo_8step_v1.0_768p",
    peopleRealismEnabled: false,
    steps: 8,
  },
  "speed-draft": {
    id: "speed-draft",
    label: "Speed Draft",
    speedLora: "minimax_h3_ref2v_turbo_4step_v0.1",
    peopleRealismEnabled: true,
    steps: 6,
  },
};

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampStrength(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(2, Number(number.toFixed(2))));
}

function normalizePreset(value: unknown): H3RealismPresetId {
  const id = String(value || "balanced") as H3RealismPresetId;
  return H3_REALISM_PRESETS[id] ? id : "balanced";
}

function normalizeSpeedLora(value: unknown, fallback: H3RealismSpeedLoraId) {
  const id = String(value || "") as H3RealismSpeedLoraId;
  return H3_REALISM_SPEED_LORAS[id] ? id : fallback;
}

export function normalizeH3RealismLoras(
  input: H3RealismLoraSettingsInput | null | undefined,
): H3RealismNormalizedLoras {
  const presetId = normalizePreset(input?.preset);
  const preset = H3_REALISM_PRESETS[presetId];
  const requestedSpeedLoras = asArray(input?.speedLoras)
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  if (requestedSpeedLoras.length > 1) {
    throw new Error("Choose exactly one Realism speed LoRA. Do not stack speed LoRAs.");
  }

  const speedLora = normalizeSpeedLora(
    requestedSpeedLoras[0] || input?.speedLora,
    preset.speedLora,
  );
  const speed = H3_REALISM_SPEED_LORAS[speedLora];
  const peopleRealismEnabled =
    typeof input?.peopleRealismEnabled === "boolean"
      ? input.peopleRealismEnabled
      : preset.peopleRealismEnabled;
  const steps = Math.max(
    1,
    Math.min(
      24,
      Math.round(Number(input?.steps) || preset.steps || speed.defaultSteps),
    ),
  );
  const speedStrength = clampStrength(input?.speedStrength, speed.defaultStrength);
  const peopleStrength = clampStrength(
    input?.peopleStrength,
    H3_REALISM_PEOPLE_LORA.defaultStrength,
  );

  return {
    preset: presetId,
    speedLora,
    peopleRealismEnabled,
    speedStrength,
    peopleStrength,
    steps,
    loras: [
      {
        id: speedLora,
        filename: speed.filename,
        strength: speedStrength,
      },
      ...(peopleRealismEnabled
        ? [
            {
              id: H3_REALISM_PEOPLE_LORA.id,
              filename: H3_REALISM_PEOPLE_LORA.filename,
              strength: peopleStrength,
            },
          ]
        : []),
    ],
  };
}

export function normalizeH3RealismReferences(
  value: unknown,
): H3RealismReferenceInput[] {
  const references: H3RealismReferenceInput[] = [];
  for (const item of asArray(value)) {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const kind = String(record.kind || "");
      if (kind !== "image" && kind !== "video" && kind !== "audio") continue;
      references.push({
        kind,
        name: String(record.name || "").trim(),
        description: String(record.description || "").trim(),
        durationSeconds: numberOrNull(record.durationSeconds),
      });
  }
  return references;
}

export function validateH3RealismReferences(
  references: H3RealismReferenceInput[],
) {
  const images = references.filter((item) => item.kind === "image");
  const videos = references.filter((item) => item.kind === "video");
  const audios = references.filter((item) => item.kind === "audio");
  if (images.length > H3_REALISM_LIMITS.maxImages) {
    throw new Error(`Realism supports at most ${H3_REALISM_LIMITS.maxImages} image references.`);
  }
  if (videos.length > H3_REALISM_LIMITS.maxVideos) {
    throw new Error(`Realism supports at most ${H3_REALISM_LIMITS.maxVideos} video references.`);
  }
  if (audios.length > H3_REALISM_LIMITS.maxAudios) {
    throw new Error(`Realism supports at most ${H3_REALISM_LIMITS.maxAudios} audio references.`);
  }
  if (references.length > H3_REALISM_LIMITS.maxCombinedReferences) {
    throw new Error(`Realism supports at most ${H3_REALISM_LIMITS.maxCombinedReferences} combined references.`);
  }

  let totalVideoSeconds = 0;
  for (const video of videos) {
    const duration = numberOrNull(video.durationSeconds);
    if (duration === null) continue;
    if (duration < H3_REALISM_LIMITS.minVideoSeconds || duration > H3_REALISM_LIMITS.maxVideoSeconds) {
      throw new Error("Realism video references should be approximately 2 to 15 seconds each.");
    }
    totalVideoSeconds += duration;
  }
  if (totalVideoSeconds > H3_REALISM_LIMITS.maxTotalVideoSeconds) {
    throw new Error("Realism video references should total about 15 seconds or less.");
  }

  const totalAudioSeconds = audios
    .map((item) => numberOrNull(item.durationSeconds))
    .filter((item): item is number => item !== null)
    .reduce((sum, item) => sum + item, 0);
  if (totalAudioSeconds > H3_REALISM_LIMITS.maxTotalAudioSeconds) {
    throw new Error("Realism audio references should total about 15 seconds or less.");
  }
}

export function validateH3RealismRequest(input: H3RealismRequestInput) {
  const prompt = String(input.prompt || "").trim();
  const quality = String(input.quality || "") as H3Quality;
  const orientation = String(input.orientation || "") as H3Orientation;
  const durationSeconds = Number(input.durationSeconds) as H3ProductionDuration;
  const references = normalizeH3RealismReferences(input.references);
  if (!prompt) throw new Error("Enter a Realism prompt before generating.");
  if (!H3_QUALITY_OPTIONS.includes(quality)) throw new Error("Choose SH, LQ, or HQ.");
  if (!H3_ORIENTATION_OPTIONS.includes(orientation)) throw new Error("Choose Landscape or Portrait orientation.");
  if (!H3_PRODUCTION_DURATION_OPTIONS.includes(durationSeconds)) throw new Error("Choose a 5- or 10-second duration.");
  validateH3RealismReferences(references);
  const loras = normalizeH3RealismLoras(input.loraSettings);
  return {
    prompt,
    quality,
    orientation,
    durationSeconds,
    references,
    loras,
  };
}

function referenceLabel(kind: H3RealismReferenceKind, index: number) {
  if (kind === "image") return `<Picture ${index}>`;
  if (kind === "video") return `<Video ${index}>`;
  return `<Audio ${index}>`;
}

export function labelH3RealismReferences(references: H3RealismReferenceInput[]) {
  const counts: Record<H3RealismReferenceKind, number> = {
    image: 0,
    video: 0,
    audio: 0,
  };
  return references.map((item) => {
    counts[item.kind] += 1;
    return {
      ...item,
      label: referenceLabel(item.kind, counts[item.kind]),
    };
  });
}

function inferPrimarySubject(prompt: string) {
  const match = prompt.match(/\b(man|woman|person|boy|girl|child|teen|adult|couple|family|crowd|dog|cat|car|vehicle)\b/i);
  return match?.[1]?.toLowerCase() || "primary subject";
}

function referenceLines(references: H3RealismReferenceInput[]) {
  return labelH3RealismReferences(references).map((item) => {
    const description = item.description || item.name || "reference material";
    return `${item.label}: ${description}`;
  });
}

export function compileH3RealismPrompt(input: H3RealismCompileInput) {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Enter a Realism prompt before compiling.");
  const protectedPrompt = appendProtectedDialogueBlock(prompt);
  const protectedDialogue = detectProtectedDialogue(prompt);
  const references = input.references || [];
  validateH3RealismReferences(references);
  const loras = input.loras || normalizeH3RealismLoras({ preset: "balanced" });
  const subject = inferPrimarySubject(prompt);
  const refs = referenceLines(references);
  const imageRefs = labelH3RealismReferences(references).filter((item) => item.kind === "image");
  const videoRefs = labelH3RealismReferences(references).filter((item) => item.kind === "video");
  const audioRefs = labelH3RealismReferences(references).filter((item) => item.kind === "audio");
  const duration = input.durationSeconds || 5;
  const orientation = input.orientation || "landscape";

  const sections = [
    "subject_definitions:",
    `<Subject 1> is the ${subject} described by the user prompt. Preserve the user's supplied identity, age/gender wording, face, skin, hair, body/build, wardrobe, actions, and dialogue exactly where provided.`,
    imageRefs.length
      ? imageRefs.map((item) => `${item.label} is an image reference for identity, face, wardrobe, materials, or scene details: ${item.description || item.name || "use visual details from this picture"}.`).join("\n")
      : "No image reference was supplied. Do not invent extra characters.",
    videoRefs.length
      ? videoRefs.map((item) => `${item.label} is a video reference for motion, timing, camera feel, scene continuity, or performance: ${item.description || item.name || "use motion and temporal cues from this video"}.`).join("\n")
      : "No video reference was supplied.",
    audioRefs.length
      ? audioRefs.map((item) => `${item.label} is an audio reference for pace, voice, ambience, or sound texture: ${item.description || item.name || "use audio character only where relevant"}.`).join("\n")
      : "No standalone audio reference was supplied.",
    "",
    "summary:",
    `[realistic MiniMax H3 reference generation] Create a ${duration}-second ${orientation} video from this user intent: ${protectedPrompt}`,
    refs.length ? `Connected references in order:\n${refs.join("\n")}` : "No external references are connected.",
    "",
    "creative_direction:",
    h3CreativeDirectionLines(input.creative),
    "",
    "retention_analysis:",
    "<Subject 1>: preserve the user-provided identity and any supplied reference identity. Retain natural facial anatomy, skin texture, hair continuity, body scale, wardrobe continuity, and action intent. Do not introduce unrequested people.",
    videoRefs.length
      ? "Video references: retain only the requested motion, timing, framing, scene, lighting, and continuity cues. Do not copy unrelated identities unless the user explicitly asks."
      : "Video references: none.",
    audioRefs.length
      ? "Audio references: use only pace, ambience, dialogue timing, or vocal texture when compatible with the visual request."
      : "Audio references: none.",
    "",
    "detailed_description:",
    [
      "Render highly realistic human proportions and natural scene physics.",
      "Honor the user's action, environment, lighting, camera/framing, motion, and continuity instructions.",
      "Use restrained, coherent camera behavior unless the user specifically asks for a move.",
      protectedDialogue.hasDialogue
        ? "Protected dialogue is present. Preserve each quoted line, speaker, delivery, and ordering exactly."
        : "No protected dialogue was supplied. Do not invent spoken dialogue.",
      "Preserve user-provided dialogue without rewriting it.",
      "Avoid waxy skin, oily faces, melted features, identity drift, extra limbs, unrequested characters, and visible reference artifacts.",
    ].join(" "),
    "",
    "overall_soundscape:",
    "Use natural diegetic sound that matches the described place and action. If dialogue is present, keep wording and intent unchanged.",
    "",
    "non_diegetic_music:",
    "No added music unless the user explicitly requests music.",
  ].join("\n");

  return loras.peopleRealismEnabled
    ? `${H3_REALISM_PEOPLE_TRIGGER}\n\n${sections}`
    : sections;
}
