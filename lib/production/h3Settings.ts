export type H3RenderMode = "turbo" | "native";
import { H3_OMNIREF, isH3OmniRefMode } from "@/lib/h3OmniRef";
// Existing persisted "singularity" continues to mean v2; v1.3 is explicit.
export type H3CheckpointMode = "standard" | "singularity" | "singularity-v1.3" | "fasth3" | "selflift";
export type H3SingularityMode = Extract<H3CheckpointMode, "singularity" | "singularity-v1.3">;
export function isH3SingularityMode(value: unknown): value is H3SingularityMode {
  return value === "singularity" || value === "singularity-v1.3";
}
export type H3RefModStrength = "balanced" | "strong";

export type H3AdvancedSettings = {
  renderMode: H3RenderMode;
  checkpointMode: H3CheckpointMode;
  combatLoraEnabled: boolean;
  refMod: {
    enabled: boolean;
    strength: H3RefModStrength;
    targetReference?: number;
  };
  motionLab: {
    enabled: boolean;
  };
};

export type H3ResolvedRenderSettings = {
  settings: H3AdvancedSettings;
  steps: 8 | 20;
  sampler: "euler" | "res_multistep";
  scheduler: "simple";
  turboLora: boolean;
  checkpoint: "standard" | typeof H3_SINGULARITY_CHECKPOINT | typeof H3_SINGULARITY_V13_CHECKPOINT | typeof H3_OMNIREF.checkpoint;
  singularityLoras: Array<{
    label: string;
    filename: string;
    strength: number;
  }>;
  attentionPath: "sla" | "vsa";
  refModRetention: 0.7 | 1.0 | null;
  motionLabInject: 0.48 | null;
};

export const DEFAULT_H3_ADVANCED_SETTINGS: H3AdvancedSettings = {
  renderMode: "turbo",
  checkpointMode: "standard",
  combatLoraEnabled: true,
  refMod: {
    enabled: false,
    strength: "balanced",
  },
  motionLab: {
    enabled: false,
  },
};

export const H3_SINGULARITY_CHECKPOINT =
  "Minimax-h3_Singularity_ref2va_v2_pruned_int8.safetensors" as const;
export const H3_SINGULARITY_LABEL = "Singularity v2" as const;
export const H3_SINGULARITY_V13_CHECKPOINT =
  "Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors" as const;
export const H3_SINGULARITY_V13_SHA256 = "412a7b126595a958964193f3b42513d7cf2df4196ef04223a0f05e3622949cce" as const;
export function h3SingularityCheckpoint(mode: H3SingularityMode) {
  return mode === "singularity-v1.3" ? H3_SINGULARITY_V13_CHECKPOINT : H3_SINGULARITY_CHECKPOINT;
}
export function h3SingularityLabel(mode: unknown) {
  return mode === "singularity-v1.3" ? "Singularity v1.3" : H3_SINGULARITY_LABEL;
}
// Publisher-hosted pruned INT8; do not alias v1.3 to this filename.
export const H3_SINGULARITY_SOURCE = {
  repository: "WarmBloodAban/Minimax-h3_Singularity",
  revision: "1259cf16cd0b655ba691a32fb46a409142762972",
  sha256: "d7637c2c35cd30facd9e93778c491f6d82f91c4a441aecbdb4c384a62a5f3d9f",
  bytes: 20967647456,
} as const;
export const H3_COMBAT_V2_LORA = "H3_Combat_V2.safetensors" as const;
export const H3_REALISM_TEST19_LORA =
  "h3-realism-people-t2v-i2v-r2v.safetensors" as const;

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeH3AdvancedSettings(
  value: unknown,
  referenceCount = 0,
): H3AdvancedSettings {
  const record = cleanObject(value);
  const checkpointMode =
    isH3OmniRefMode(record.checkpointMode) || isH3SingularityMode(record.checkpointMode) ? record.checkpointMode : "standard";
  const renderMode =
    record.renderMode === "native" ? "native" : "turbo";
  const refMod = cleanObject(record.refMod);
  const target =
    Number.isSafeInteger(refMod.targetReference)
      ? Math.max(0, Math.min(referenceCount - 1, Number(refMod.targetReference)))
      : undefined;
  const refModEnabled =
    refMod.enabled === true && referenceCount > 0;

  return {
    renderMode,
    checkpointMode,
    combatLoraEnabled: record.combatLoraEnabled !== false,
    refMod: {
      enabled: refModEnabled,
      strength: refMod.strength === "strong" ? "strong" : "balanced",
      ...(target !== undefined && referenceCount > 1 ? { targetReference: target } : {}),
    },
    motionLab: {
      enabled: cleanObject(record.motionLab).enabled === true,
    },
  };
}

export function selectH3CheckpointMode(
  current: H3AdvancedSettings,
  checkpointMode: H3CheckpointMode,
  referenceCount = 0,
) {
  return normalizeH3AdvancedSettings({
    ...current,
    checkpointMode,
  }, referenceCount);
}

export function selectH3RenderMode(
  current: H3AdvancedSettings,
  renderMode: H3RenderMode,
  referenceCount = 0,
) {
  return normalizeH3AdvancedSettings({
    ...current,
    renderMode,
  }, referenceCount);
}

export function resolveH3RenderSettings(
  value: unknown,
  referenceCount = 0,
): H3ResolvedRenderSettings {
  const settings = normalizeH3AdvancedSettings(value, referenceCount);
  const fast = isH3OmniRefMode(settings.checkpointMode);
  const native = !fast && settings.renderMode === "native";
  const singularity = isH3SingularityMode(settings.checkpointMode);

  return {
    settings,
    steps: native ? 20 : 8,
    sampler: native ? "res_multistep" : "euler",
    scheduler: "simple",
    turboLora: !native && !fast,
    checkpoint: fast ? H3_OMNIREF.checkpoint : isH3SingularityMode(settings.checkpointMode) ? h3SingularityCheckpoint(settings.checkpointMode) : "standard",
    singularityLoras: singularity
      ? [
          ...(settings.combatLoraEnabled
            ? [
                {
                  label: "Combat V2",
                  filename: H3_COMBAT_V2_LORA,
                  strength: 1,
                },
              ]
            : []),
          { label: "Realism", filename: H3_REALISM_TEST19_LORA, strength: 0.7 },
        ]
      : [],
    attentionPath: fast ? "vsa" : "sla",
    refModRetention:
      !fast && settings.refMod.enabled
        ? settings.refMod.strength === "strong" ? 1 : 0.7
        : null,
    motionLabInject: !fast && settings.motionLab.enabled ? 0.48 : null,
  };
}
