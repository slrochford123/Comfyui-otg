import installed from "@/lib/h3Stage1cInstalled.json";
import { registeredH3Lora } from "@/lib/h3RegisteredLoras";

const byFile = new Map(installed.entries.map(entry => [entry.filename, entry]));
const byId = new Map(installed.entries.map(entry => [`civitai-${entry.modelId}-${entry.versionId}`, entry]));

export function installedH3LoraGuidance(filename: string | null | undefined) {
  return filename ? byFile.get(filename) : undefined;
}

/** Wider signed ranges belong only to exact, author-documented slider versions. */
export function h3RegisteredLoraStrengthBounds(id: string) {
  const entry = byId.get(id) || installed.additionalInstalled.find(entry => entry.id === id);
  return { min: entry?.minStrength ?? 0, max: entry?.maxStrength ?? 2 };
}

export function h3LoraDefaultStrength(filename: string | null | undefined, fallback = 1, min = 0, max = 2, mode?: string) {
  const entry = installedH3LoraGuidance(filename);
  const value = entry?.versionId === 3361017 && mode === "h3-image-to-video" ? .4 : entry?.defaultStrength ?? fallback;
  return Math.max(min, Math.min(max, value));
}

export type H3PromptLora = { filename: string; strength: number; enabled?: boolean; triggerWords?: readonly string[] };

function containsPhrase(prompt: string, phrase: string) {
  const needle = phrase.normalize("NFKC").trim().replace(/[,.;!?\s]+$/u, "");
  if (!needle) return true;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(prompt.normalize("NFKC"));
}

/** Called after server-side selection/media validation, and again at compilation.
 * Derived prompt only: never mutate the user's original text or saved presets.
 * The exact installed record wins over stale cached upstream trigger lists.
 */
export function applyH3LoraTriggers(prompt: string, selections: readonly H3PromptLora[] = []) {
  let result = prompt.trim();
  for (const selection of selections) {
    if (selection.enabled === false || selection.strength === 0) continue;
    const entry = installedH3LoraGuidance(selection.filename);
    // Keep structured legacy Combat normal/high-action/finisher semantics.
    // Stage 1C author guidance still overrides stale caller trigger lists.
    const words = entry ? entry.triggerWords : selection.triggerWords ?? registeredH3Lora(selection.filename)?.triggerWords ?? [];
    for (const raw of words) {
      const word = raw.trim();
      // Never insert an unfilled author prompt template or control characters.
      if (!word || word.length > 1000 || /[<>\u0000-\u001f]/u.test(word)) continue;
      if (word === "vfx_edit:") {
        if (!/^vfx_edit\s*:/iu.test(result)) result = `${word} ${result.replace(/\bvfx_edit\s*:\s*/giu, "")}`;
      } else if (!containsPhrase(result, word)) {
        result = [result, word].filter(Boolean).join("\n");
      }
    }
  }
  return result;
}
