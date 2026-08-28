export const H3_VISUAL_STYLE_LORA_OPTIONS = ["none", "realism", "gurren"] as const;
export const H3_COMBAT_LORA_MODES = ["off", "normal", "high-action", "finisher"] as const;

export type ProductionV2H3VisualStyleLora = (typeof H3_VISUAL_STYLE_LORA_OPTIONS)[number];
export type ProductionV2H3CombatLoraMode = (typeof H3_COMBAT_LORA_MODES)[number];

export type ProductionV2H3UserLoraState = {
  visualStyle: ProductionV2H3VisualStyleLora;
  combatMode: ProductionV2H3CombatLoraMode;
  motionRepair: {
    enabled: boolean;
    useTrigger: boolean;
  };
};

export const DEFAULT_PRODUCTION_V2_H3_USER_LORAS: ProductionV2H3UserLoraState = {
  visualStyle: "none",
  combatMode: "off",
  motionRepair: {
    enabled: false,
    useTrigger: false,
  },
};

export const H3_USER_LORA_CATALOG = {
  realism: {
    id: "realism",
    label: "Realism",
    filename: "h3-realism-people-t2v-i2v-r2v.safetensors",
    strength: 1,
    experimental: false,
  },
  gurren: {
    id: "gurren",
    label: "Gurren",
    filename: "GL_H3_V1-step00017250.safetensors",
    strength: 1,
    experimental: false,
  },
  combat: {
    id: "combat",
    label: "Combat",
    filename: "H3_Combat_V2.safetensors",
    strength: 0.7,
    experimental: false,
  },
  motionRepair: {
    id: "motion-repair",
    label: "Motion Repair",
    filename: "Motion_Repair.safetensors",
    strength: 0.9,
    experimental: true,
  },
} as const;

export type ResolvedProductionV2H3UserLora = {
  id: "realism" | "gurren" | "combat" | "motion-repair";
  label: string;
  filename: string;
  strength: number;
  triggerPhrases: string[];
  experimental: boolean;
};

export function normalizeProductionV2H3UserLoras(value: unknown): ProductionV2H3UserLoraState {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const visualStyle = H3_VISUAL_STYLE_LORA_OPTIONS.includes(record.visualStyle as ProductionV2H3VisualStyleLora)
    ? record.visualStyle as ProductionV2H3VisualStyleLora
    : "none";
  const combatMode = H3_COMBAT_LORA_MODES.includes(record.combatMode as ProductionV2H3CombatLoraMode)
    ? record.combatMode as ProductionV2H3CombatLoraMode
    : "off";
  const rawMotion = record.motionRepair && typeof record.motionRepair === "object" && !Array.isArray(record.motionRepair)
    ? record.motionRepair as Record<string, unknown>
    : {};
  const motionEnabled = rawMotion.enabled === true;
  return {
    visualStyle,
    combatMode,
    motionRepair: {
      enabled: motionEnabled,
      useTrigger: motionEnabled && rawMotion.useTrigger === true,
    },
  };
}

export function resolveProductionV2H3UserLoras(value: unknown): ResolvedProductionV2H3UserLora[] {
  const state = normalizeProductionV2H3UserLoras(value);
  const resolved: ResolvedProductionV2H3UserLora[] = [];

  if (state.visualStyle === "realism") {
    resolved.push({
      ...H3_USER_LORA_CATALOG.realism,
      triggerPhrases: ["r34l1sm"],
    });
  } else if (state.visualStyle === "gurren") {
    resolved.push({
      ...H3_USER_LORA_CATALOG.gurren,
      triggerPhrases: ["2d anime style, Gurren Lagann Style"],
    });
  }

  if (state.combatMode !== "off") {
    resolved.push({
      ...H3_USER_LORA_CATALOG.combat,
      triggerPhrases: state.combatMode === "normal"
        ? []
        : state.combatMode === "high-action"
          ? ["prfight2"]
          : ["prfight2", "prfin1"],
    });
  }

  if (state.motionRepair.enabled) {
    resolved.push({
      ...H3_USER_LORA_CATALOG.motionRepair,
      triggerPhrases: state.motionRepair.useTrigger ? ["bunny_crisp_motion"] : [],
    });
  }

  return resolved;
}

export function productionV2H3UserLoraFilenames(value: unknown) {
  return resolveProductionV2H3UserLoras(value).map((lora) => lora.filename);
}

export function productionV2H3UserLoraTriggers(value: unknown) {
  const seen = new Set<string>();
  return resolveProductionV2H3UserLoras(value).flatMap((lora) => lora.triggerPhrases).filter((trigger) => {
    const key = trigger.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedPrompt(value: unknown) {
  return String(value ?? "").trim();
}

function promptContainsTrigger(prompt: string, trigger: string) {
  const haystack = prompt.toLowerCase().replace(/\s+/g, " ");
  const needle = trigger.toLowerCase().replace(/\s+/g, " ");
  return haystack.includes(needle);
}

export function applyProductionV2H3UserLoraTriggers(prompt: string, value: unknown) {
  const scenePrompt = normalizedPrompt(prompt);
  const missing = productionV2H3UserLoraTriggers(value)
    .filter((trigger) => !promptContainsTrigger(scenePrompt, trigger));
  return [scenePrompt, ...missing.map((trigger) => `LoRA trigger: ${trigger}`)]
    .filter(Boolean)
    .join("\n");
}

export function assertProductionV2H3UserLoraTriggers(prompt: string, value: unknown) {
  const scenePrompt = normalizedPrompt(prompt);
  const missing = productionV2H3UserLoraTriggers(value)
    .filter((trigger) => !promptContainsTrigger(scenePrompt, trigger));
  if (missing.length) {
    throw new Error(`The reviewed H3 Scene Prompt is missing enabled LoRA trigger text: ${missing.join(", ")}. Rebuild and review the prompt.`);
  }
  return true;
}
