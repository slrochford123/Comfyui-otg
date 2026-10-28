import installed from "@/lib/h3Stage1cInstalled.json";
import { H3_OMNIREF } from "@/lib/h3OmniRef";
import { h3LoraDefaultStrength } from "@/lib/h3LoraGuidance";
import { registeredH3Lora } from "@/lib/h3RegisteredLoras";

/** Read compatibility from the existing canonical installation ledger, not a second catalog.
 * Header/key/shape verification is structural evidence, never output qualification. */
export function fastH3LoraBlockReason(filename: string | null | undefined, strength?: number): string | null {
  const entry = registeredH3Lora(filename);
  if (!entry) return "FastH3 requires an exact installed catalog LoRA with checked model targets.";
  if ([3219346, 3219337, 3297123, 3294126].includes(entry.versionId || 0)) return "Do not stack a legacy Turbo/acceleration adapter on FastH3.";
  if (entry.family !== "Ref2VA" && entry.family !== "both") return "This LoRA is not compatible with Reference-to-Video.";
  const proof = entry.fastH3;
  if (!proof || proof.checkpointSha256 !== H3_OMNIREF.sha256 || proof.adapterSha256 !== entry.sha256 || proof.matchedTargets < 1) {
    return "FastH3 LoRA target/shape verification is missing for this exact file.";
  }
  if (strength !== undefined && (!Number.isFinite(strength) || strength < entry.minStrength || strength > entry.maxStrength)) {
    return `FastH3 LoRA strength must be between ${entry.minStrength} and ${entry.maxStrength}.`;
  }
  return null;
}

export function assertFastH3Loras(loras: readonly { filename: string; strength: number }[]) {
  for (const lora of loras) {
    const reason = fastH3LoraBlockReason(lora.filename, lora.strength);
    if (reason) throw new Error(reason);
  }
}

export function assertFastH3StudioLoras(loras: readonly { id: string; strength: number; enabled: boolean }[]) {
  for (const lora of loras.filter(selection => selection.enabled)) {
    const entry = installed.entries.find(item => `civitai-${item.modelId}-${item.versionId}` === lora.id)
      || installed.additionalInstalled.find(item => item.id === lora.id);
    const reason = fastH3LoraBlockReason(entry?.filename, lora.strength);
    if (reason) throw new Error(reason);
  }
}

export function fastH3LoraDefaultStrength(filename: string | null, min?: number, max?: number) {
  const entry = registeredH3Lora(filename);
  return h3LoraDefaultStrength(filename, entry?.defaultStrength ?? 1, min ?? entry?.minStrength ?? 0, max ?? entry?.maxStrength ?? 2);
}
