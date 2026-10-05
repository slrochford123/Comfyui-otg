export type H3RenderMode = "turbo" | "native";
export type H3CheckpointMode = "standard" | "singularity";
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
  checkpoint: "standard" | "Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors";
  singularityLoras: Array<{
    label: string;
    filename: string;
    strength: number;
  }>;
  attentionPath: "sla";
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
  "Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors" as const;
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
    record.checkpointMode === "singularity" ? "singularity" : "standard";
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
  const native = settings.renderMode === "native";
  const singularity = settings.checkpointMode === "singularity";

  return {
    settings,
    steps: native ? 20 : 8,
    sampler: native ? "res_multistep" : "euler",
    scheduler: "simple",
    turboLora: !native,
    checkpoint: singularity ? H3_SINGULARITY_CHECKPOINT : "standard",
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
    attentionPath: "sla",
    refModRetention:
      settings.refMod.enabled
        ? settings.refMod.strength === "strong" ? 1 : 0.7
        : null,
    motionLabInject: settings.motionLab.enabled ? 0.48 : null,
  };
}
