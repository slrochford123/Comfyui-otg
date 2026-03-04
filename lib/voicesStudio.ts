import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { OTG_DATA_ROOT, ensureDir, readJsonSafe, safeJoin, safeSegment, writeJsonSafe } from "@/lib/paths";

export type VoiceStudioType = "cloned" | "created";

export type VoiceStudioEntry = {
  voiceId: string;
  name: string;
  tags: string[];
  type: VoiceStudioType;

  // What is spoken in the reference audio (used for clone prompt quality).
  refText: string;

  // Relative to the global voices root (never store absolute paths in the library).
  // Example: samples/<voiceId>/ref.wav
  refAudioRel: string;

  // Optional: when the reference was uploaded as a video, keep the original video file path too
  // (still under samples/<voiceId>/...). The clone/transcribe pipelines always use refAudioRel.
  refVideoRel?: string;

  createdAt: string;
  updatedAt: string;
};

type VoiceStudioLibrary = {
  version: 1;
  voices: VoiceStudioEntry[];
};

export function voicesRoot(): string {
  const root = safeJoin(OTG_DATA_ROOT, "uploads", "voices");
  ensureDir(root);
  ensureDir(safeJoin(root, "library"));
  ensureDir(safeJoin(root, "emotions"));
  ensureDir(safeJoin(root, "samples"));
  ensureDir(safeJoin(root, "outputs"));
  return root;
}

export function ownerPrefix(ownerKey: string): string {
  return safeSegment(ownerKey || "local");
}

export function voicesLibraryPath(ownerKey: string): string {
  const pref = ownerPrefix(ownerKey);
  return safeJoin(voicesRoot(), "library", `${pref}.json`);
}

export function voicesSamplesDir(voiceId: string): string {
  const dir = safeJoin(voicesRoot(), "samples", safeSegment(voiceId));
  ensureDir(dir);
  return dir;
}

export function voicesOutputsDir(voiceId?: string): string {
  const base = safeJoin(voicesRoot(), "outputs");
  ensureDir(base);
  if (!voiceId) return base;
  const dir = safeJoin(base, safeSegment(voiceId));
  ensureDir(dir);
  return dir;
}

export function resolveVoicesFile(rel: string): string {
  const safeRel = (rel || "").toString().replace(/\\/g, "/");
  return safeJoin(voicesRoot(), safeRel);
}

export function newVoiceId(ownerKey: string): string {
  const rnd = crypto.randomBytes(6).toString("hex");
  const pref = ownerPrefix(ownerKey);
  return `${pref}__v_${Date.now()}_${rnd}`;
}

export function loadVoicesLibrary(ownerKey: string): VoiceStudioLibrary {
  const p = voicesLibraryPath(ownerKey);
  const lib = readJsonSafe<VoiceStudioLibrary>(p, { version: 1, voices: [] });
  if (!lib || lib.version !== 1 || !Array.isArray(lib.voices)) return { version: 1, voices: [] };
  return lib;
}

export function saveVoicesLibrary(ownerKey: string, lib: VoiceStudioLibrary): void {
  writeJsonSafe(voicesLibraryPath(ownerKey), lib);
}

export function upsertVoice(ownerKey: string, entry: VoiceStudioEntry): VoiceStudioEntry {
  const lib = loadVoicesLibrary(ownerKey);
  const now = new Date().toISOString();
  const next: VoiceStudioEntry = {
    ...entry,
    tags: Array.isArray(entry.tags) ? entry.tags.map((t) => String(t)).filter(Boolean) : [],
    updatedAt: now,
    createdAt: entry.createdAt || now,
  };

  const idx = lib.voices.findIndex((v) => v.voiceId === next.voiceId);
  if (idx >= 0) lib.voices[idx] = next;
  else lib.voices.unshift(next);

  lib.voices.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  saveVoicesLibrary(ownerKey, lib);
  return next;
}

export function getVoiceById(ownerKey: string, voiceId: string): VoiceStudioEntry | null {
  const lib = loadVoicesLibrary(ownerKey);
  return lib.voices.find((v) => v.voiceId === voiceId) || null;
}

export function deleteVoice(ownerKey: string, voiceId: string): boolean {
  const lib = loadVoicesLibrary(ownerKey);
  const before = lib.voices.length;
  lib.voices = lib.voices.filter((v) => v.voiceId !== voiceId);
  if (lib.voices.length === before) return false;
  saveVoicesLibrary(ownerKey, lib);
  return true;
}

export function writeBinaryFile(absPath: string, buf: Buffer) {
  ensureDir(path.dirname(absPath));
  fs.writeFileSync(absPath, buf);
}
