import crypto from "node:crypto";

import { ensureDir, readJsonSafe, safeJoin, safeSegment, writeJsonSafe } from "@/lib/paths";
import { ownerPrefix, voicesRoot } from "@/lib/voicesStudio";

export type VoiceEmotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "calm"
  | "whisper"
  | "custom";

export type VoiceEmotionPreset = {
  presetId: string;
  voiceId: string;
  emotion: VoiceEmotion;
  label: string;
  intensityTag?: number; // 1..5 tag only (selection hint)
  refText: string;
  refAudioRel: string;
  createdAt: string;
  updatedAt: string;
};

type VoiceEmotionLibrary = {
  version: 1;
  // voiceId -> presets
  presetsByVoice: Record<string, VoiceEmotionPreset[]>;
};

function emotionsDir(): string {
  const dir = safeJoin(voicesRoot(), "emotions");
  ensureDir(dir);
  return dir;
}

export function emotionsLibraryPath(ownerKey: string): string {
  const pref = ownerPrefix(ownerKey);
  return safeJoin(emotionsDir(), `${pref}.json`);
}

export function loadEmotionsLibrary(ownerKey: string): VoiceEmotionLibrary {
  const lib = readJsonSafe<VoiceEmotionLibrary>(emotionsLibraryPath(ownerKey), {
    version: 1,
    presetsByVoice: {},
  });
  if (!lib || lib.version !== 1 || typeof lib.presetsByVoice !== "object" || !lib.presetsByVoice) {
    return { version: 1, presetsByVoice: {} };
  }
  return lib;
}

export function saveEmotionsLibrary(ownerKey: string, lib: VoiceEmotionLibrary): void {
  writeJsonSafe(emotionsLibraryPath(ownerKey), lib);
}

export function newPresetId(ownerKey: string, voiceId: string): string {
  const rnd = crypto.randomBytes(6).toString("hex");
  const pref = ownerPrefix(ownerKey);
  const v = safeSegment(voiceId);
  return `${pref}__p_${v}_${Date.now()}_${rnd}`;
}

export function listPresets(ownerKey: string, voiceId: string): VoiceEmotionPreset[] {
  const lib = loadEmotionsLibrary(ownerKey);
  const v = safeSegment(voiceId);
  const arr = Array.isArray(lib.presetsByVoice?.[v]) ? lib.presetsByVoice[v] : [];
  return arr.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function getPresetById(ownerKey: string, voiceId: string, presetId: string): VoiceEmotionPreset | null {
  const presets = listPresets(ownerKey, voiceId);
  return presets.find((p) => p.presetId === presetId) || null;
}

export function upsertPreset(ownerKey: string, preset: VoiceEmotionPreset): VoiceEmotionPreset {
  const lib = loadEmotionsLibrary(ownerKey);
  const v = safeSegment(preset.voiceId);
  const now = new Date().toISOString();
  const next: VoiceEmotionPreset = {
    ...preset,
    voiceId: v,
    presetId: safeSegment(preset.presetId),
    label: String(preset.label || "").trim().slice(0, 60) || "Preset",
    emotion: (preset.emotion || "custom") as any,
    intensityTag: typeof preset.intensityTag === "number" ? Math.max(1, Math.min(5, Math.round(preset.intensityTag))) : undefined,
    refText: String(preset.refText || ""),
    refAudioRel: String(preset.refAudioRel || ""),
    createdAt: preset.createdAt || now,
    updatedAt: now,
  };

  const arr = Array.isArray(lib.presetsByVoice[v]) ? lib.presetsByVoice[v] : [];
  const idx = arr.findIndex((p) => p.presetId === next.presetId);
  if (idx >= 0) arr[idx] = next;
  else arr.unshift(next);
  lib.presetsByVoice[v] = arr;
  saveEmotionsLibrary(ownerKey, lib);
  return next;
}

export function deletePreset(ownerKey: string, voiceId: string, presetId: string): boolean {
  const lib = loadEmotionsLibrary(ownerKey);
  const v = safeSegment(voiceId);
  const before = Array.isArray(lib.presetsByVoice[v]) ? lib.presetsByVoice[v].length : 0;
  lib.presetsByVoice[v] = (Array.isArray(lib.presetsByVoice[v]) ? lib.presetsByVoice[v] : []).filter((p) => p.presetId !== presetId);
  saveEmotionsLibrary(ownerKey, lib);
  return (lib.presetsByVoice[v]?.length || 0) !== before;
}
