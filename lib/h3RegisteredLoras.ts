import installed from "@/lib/h3Stage1cInstalled.json";

export type RegisteredH3Lora = {
  filename: string; aliases?: string[]; sha256: string; bytes: number;
  displayName: string; family: string; minStrength: number; maxStrength: number;
  defaultStrength: number; triggerWords: string[]; id?: string; versionId?: number;
  fastH3?: { checkpointSha256: string; adapterSha256: string; matchedTargets: number; validation: string };
};

/** One installation ledger, including existing H3 files outside Stage 1C.
 * Additional entries are structural installation evidence, not license or
 * generated-output qualification. Exact aliases share a verified file hash. */
export const registeredH3Loras: readonly RegisteredH3Lora[] = [
  ...installed.entries, ...installed.additionalInstalled,
];
const byFilename = new Map(registeredH3Loras.flatMap(entry =>
  [entry.filename, ...(entry.aliases || [])].map(filename => [filename, entry] as const)));

export function registeredH3Lora(filename: string | null | undefined) {
  return filename ? byFilename.get(filename) : undefined;
}

export function h3AccelerationLora(entry: RegisteredH3Lora) {
  return [3219346, 3219337, 3297123, 3294126].includes(entry.versionId || 0);
}

export function isRegisteredInstalledH3LoraId(id: string) {
  return installed.additionalInstalled.some(entry => entry.id === id);
}
