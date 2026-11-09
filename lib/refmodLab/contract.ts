export const REFMOD_LAB_ID = "refmod-replacement";
export const REFMOD_LAB_API = "/api/experiments/refmod-replacement";
export const LAB_WORKFLOWS = { A: "Direct RefMod", B: "Character Swap + RefMod", C: "Masked Character Edit" } as const;
export type ReplacementSettings = {
  workflow: keyof typeof LAB_WORKFLOWS; backend: "rtx3090" | "rtx5060ti";
  model: "standard" | "singularity"; quality: "0.2" | "0.6" | "1";
  sourceId: string; imageId: string; maskId: string; refMod: string;
  subject: string; prompt: string; strength: number; swapLora: boolean; swapStrength: number;
  seconds: number; start: number; seed: number; preserveAudio: boolean; maskMode: "tracked" | "upload";
};
export const REPLACEMENT_DEFAULTS: ReplacementSettings = { workflow: "A", backend: "rtx3090", model: "standard", quality: "0.2", sourceId: "", imageId: "", maskId: "", refMod: "", subject: "", prompt: "", strength: 1, swapLora: true, swapStrength: 1, seconds: 5, start: 0, seed: 424242, preserveAudio: true, maskMode: "tracked" };
export const RATING_LABELS = { identity: "Character identity", motion: "Motion preservation", background: "Background preservation", temporal: "Temporal consistency", overall: "Overall quality" } as const;
export type Evaluation = { scores: Partial<Record<keyof typeof RATING_LABELS, number>>; notes: string };
export function parseReplacementSettings(value: unknown): ReplacementSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Choose valid lab settings.");
  const s = value as Record<string, unknown>;
  for (const [key, options] of Object.entries({ workflow: ["A", "B", "C"], backend: ["rtx3090", "rtx5060ti"], model: ["standard", "singularity"], quality: ["0.2", "0.6", "1"], maskMode: ["tracked", "upload"] })) if (!options.includes(s[key] as string)) throw Error(`Invalid ${key}.`);
  for (const key of ["sourceId", "imageId", "maskId"]) if (typeof s[key] !== "string" || s[key] && !/^[a-f0-9-]{36}$/.test(s[key] as string)) throw Error("Choose a saved input again.");
  for (const [key, max] of [["refMod", 512], ["subject", 300], ["prompt", 4000]] as const) if (typeof s[key] !== "string" || (s[key] as string).length > max || /[\x00-\x08]/.test(s[key] as string)) throw Error(`Invalid ${key}.`);
  for (const [key, min, max] of [["strength", 0, 1], ["swapStrength", 0, 2], ["seconds", 2, 10], ["start", 0, 1200], ["seed", 0, Number.MAX_SAFE_INTEGER]] as const) if (typeof s[key] !== "number" || !Number.isFinite(s[key]) || (s[key] as number) < min || (s[key] as number) > max) throw Error(`Invalid ${key}.`);
  if (!Number.isInteger(s.seconds) || !Number.isSafeInteger(s.seed) || typeof s.swapLora !== "boolean" || typeof s.preserveAudio !== "boolean") throw Error("Invalid duration, seed or audio selection.");
  // Only declared fields can enter a durable job; browser paths/graphs are never accepted.
  return Object.fromEntries(Object.keys(REPLACEMENT_DEFAULTS).map(k => [k, s[k]])) as ReplacementSettings;
}
export function parseEvaluation(value: unknown): Evaluation {
  const e = value as Evaluation;
  if (!e || !e.scores || typeof e.scores !== "object" || Array.isArray(e.scores) || typeof e.notes !== "string" || e.notes.length > 4000) throw Error("Invalid evaluation.");
  for (const [k, n] of Object.entries(e.scores)) if (!(k in RATING_LABELS) || !Number.isInteger(n) || n < 1 || n > 5) throw Error("Scores must be 1–5, or left unrated.");
  return { scores: { ...e.scores }, notes: e.notes };
}
