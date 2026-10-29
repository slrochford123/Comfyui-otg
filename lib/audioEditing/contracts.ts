export const STEMS = ["speech", "effects", "music"] as const;
export type Stem = typeof STEMS[number];
export type AudioGpu = "rtx3090" | "rtx5060ti" | "cpu";
export type Track = { keep: boolean; gain: number; solo: boolean; enhanced?: string };
export type AudioAsset = {
  id: string; name: string; file: string; kind: "video" | "audio"; duration: number;
  sampleRate?: number; channels?: number; sha256?: string; origin: string; license?: string;
  suggestedLane?: Stem;
  sourceAssetId?: string;
};
export type TimelineClip = {
  id: string; assetId: string; lane: Stem; start: number; trimStart: number; length: number;
  gain: number; fadeIn: number; fadeOut: number; loop: boolean; muted: boolean;
};
export type AudioSession = {
  version: 1; id: string; title: string; createdAt: string; updatedAt: string; revision: number;
  sourceId?: string; assets: AudioAsset[]; stems: Partial<Record<Stem, string>>;
  tracks: Record<Stem, Track>; clips: TimelineClip[]; ducking: boolean;
  completedJobs: string[]; separation?: { engine: string; warnings: string[]; cacheKey: string };
};
export const defaultTracks = (): Record<Stem, Track> => ({
  speech: { keep: true, gain: 1, solo: false }, effects: { keep: true, gain: 1, solo: false },
  music: { keep: true, gain: 1, solo: false },
});
export function numberWithin(value: unknown, fallback: number, min: number, max: number) {
  const n = value === "" || value == null ? fallback : Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}
export function normalizeEdit(raw: Record<string, unknown>, session: AudioSession) {
  const assets = new Map(session.assets.map(a => [a.id, a]));
  const tracks = defaultTracks();
  for (const stem of STEMS) {
    const value = (raw.tracks as Partial<Record<Stem, Track>> | undefined)?.[stem];
    if (value) tracks[stem] = { keep: value.keep !== false, gain: numberWithin(value.gain, 1, 0, 2), solo: value.solo === true,
      ...(value.enhanced && assets.has(value.enhanced) ? { enhanced: value.enhanced } : {}) };
  }
  const clips = (Array.isArray(raw.clips) ? raw.clips : session.clips).slice(0, 64).map((c: TimelineClip) => {
    const asset = assets.get(c.assetId);
    if (!asset || asset.kind !== "audio") throw Error("Choose an audio asset from this session.");
    const trimStart = numberWithin(c.trimStart, 0, 0, Math.max(0, asset.duration - .01));
    const length = numberWithin(c.length, asset.duration - trimStart, .01, 7200);
    return { id: String(c.id).slice(0, 80), assetId: asset.id, lane: STEMS.includes(c.lane) ? c.lane : "effects",
      start: numberWithin(c.start, 0, 0, 7200), trimStart, length,
      gain: numberWithin(c.gain, 1, 0, 2), fadeIn: numberWithin(c.fadeIn, 0, 0, length / 2),
      fadeOut: numberWithin(c.fadeOut, 0, 0, length / 2), loop: c.loop === true, muted: c.muted === true } as TimelineClip;
  });
  return { tracks, clips, ducking: raw.ducking === true, title: String(raw.title || session.title).slice(0, 100) };
}
export function activeStems(tracks: Record<Stem, Track>) {
  const solo = STEMS.some(s => tracks[s].solo);
  return STEMS.filter(s => tracks[s].keep && tracks[s].gain > 0 && (!solo || tracks[s].solo));
}
export function requiresSeparation(session: AudioSession) {
  const active = activeStems(session.tracks);
  if (active.length === 0) return false;
  return active.length !== 3 || session.ducking || STEMS.some(s => session.tracks[s].gain !== 1 || session.tracks[s].enhanced);
}
export function applyEnhancedTrack(session: AudioSession, sourceAssetId: unknown, enhanced: Partial<Record<Stem,string>>) {
  if (typeof sourceAssetId!=="string" || !sourceAssetId) return;
  for (const stem of STEMS) if (enhanced[stem] &&
    [session.stems[stem],session.tracks[stem].enhanced].includes(sourceAssetId)) session.tracks[stem].enhanced=enhanced[stem];
}
export function aukInstruction(text: string, description: string, reference: boolean, expression = "") {
  const dialogue = text.trim();
  if (!dialogue || dialogue.length > 5000) throw Error("Enter dialogue between 1 and 5000 characters.");
  const quoted = JSON.stringify(dialogue);
  return reference ? `Say the following with the same voice: ${quoted}${expression ? `. Delivery: ${expression}` : ""}`
    : `Based on the following description: ${JSON.stringify([description, expression].filter(Boolean).join(". "))}, generate speech content ${quoted}.`;
}
