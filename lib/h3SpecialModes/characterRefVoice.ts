import fs from "node:fs/promises";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {OTG_DATA_ROOT, safeSegment} from "@/lib/paths";
import {RequestError} from "@/lib/requestError";
import {listCharacters, loadCharacter} from "@/lib/characters/store";
import {loadVoicesLibrary, getVoiceById, resolveVoicesFile} from "@/lib/voicesStudio";
import type {CharacterRefVoice, CharacterRefMember} from "./characterRefCardContract";
import {characterRefCardsEnabled} from "./characterRefCardAvailability";

const run = promisify(execFile);
const audioInputLimits = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "wav,mp3,flac,ogg,mov,matroska,webm,aac"];
export const CHARACTER_VOICE_MAX_BYTES = 64 * 1024 * 1024;
export const characterRefVoiceEnabled = characterRefCardsEnabled;
export function assertCharacterRefVoiceEnabled() {
  if (!characterRefVoiceEnabled()) throw new RequestError("Character voice bundles are not enabled on this deployment.", 404);
}
export function characterRefVoiceChoices(owner: string) {
  return [
    ...loadVoicesLibrary(owner).voices.map(v => ({id: "library:" + v.voiceId, name: v.name})),
    ...listCharacters(owner).filter(c => c.referenceAudioPath).map(c => ({id: "character:" + c.id, name: c.name + " · character voice"})),
  ];
}
export function resolveCharacterRefVoice(owner: string, sourceId: string) {
  if (sourceId.startsWith("library:")) {
    const voice = getVoiceById(owner, sourceId.slice(8));
    if (voice?.refAudioRel) return {path: resolveVoicesFile(voice.refAudioRel), name: voice.name, sourceId};
  } else if (sourceId.startsWith("character:")) {
    const character = loadCharacter(owner, sourceId.slice(10));
    if (character?.referenceAudioPath) return {path: character.referenceAudioPath, name: character.name, sourceId};
  }
  throw new RequestError("Saved voice not found for this account.", 404);
}
/** Copy first, then decode the pinned copy. No truncation, mutable library link or client file path. */
export async function snapshotCharacterRefVoice(owner: string, cardId: string, source: {path: string; name: string; sourceId?: string}): Promise<CharacterRefVoice> {
  const stat = await fs.lstat(source.path);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > CHARACTER_VOICE_MAX_BYTES) throw new RequestError("Choose a voice recording up to 64 MiB.", 400);
  const id = randomUUID(), folder = path.join(OTG_DATA_ROOT, "uploads", "characters", safeSegment(owner), "refcard-" + cardId, "voice-" + id);
  await fs.mkdir(folder, {recursive: true, mode: 0o700});
  const originalPath = path.join(folder, "original.audio"), file = path.join(folder, "reference.wav");
  await fs.copyFile(source.path, originalPath); await fs.chmod(originalPath, 0o600);
  const {stdout} = await run("ffprobe", ["-v", "error", ...audioInputLimits, "-show_entries", "format=duration:stream=codec_type", "-of", "json", originalPath], {timeout: 20000, maxBuffer: 1024 * 1024});
  const probe = JSON.parse(stdout), durationSeconds = Number(probe.format?.duration);
  if (!probe.streams?.some((s: {codec_type: string}) => s.codec_type === "audio") || !Number.isFinite(durationSeconds) || durationSeconds < 2 || durationSeconds > 30) throw new RequestError("Use 2–30 seconds of one clear voice. Trim longer recordings first; nothing was silently cut.", 400);
  await run("ffmpeg", ["-v", "error", "-nostdin", "-n", ...audioInputLimits, "-i", originalPath, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "32000", "-t", "31", "-c:a", "pcm_s16le", file], {timeout: 45000, maxBuffer: 1024 * 1024});
  // Reject dishonest container durations rather than saving a clipped reference.
  const decoded=await run("ffprobe",["-v","error","-show_entries","format=duration","-of","json",file],{timeout:10000,maxBuffer:65536});
  const decodedDuration=Number(JSON.parse(decoded.stdout).format?.duration);
  if(!Number.isFinite(decodedDuration)||decodedDuration<2||decodedDuration>30.05)throw new RequestError("The decoded voice must be 2–30 seconds. Trim it and try again.",400);
  await fs.chmod(file, 0o600);
  return {id, name: source.name.slice(0, 140), sourceId: source.sourceId, originalPath, path: file, durationSeconds: decodedDuration, sha256: createHash("sha256").update(await fs.readFile(file)).digest("hex")};
}
export async function assertCharacterRefVoiceIntact(voice: CharacterRefVoice) {
  const stat = await fs.lstat(voice.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > CHARACTER_VOICE_MAX_BYTES || createHash("sha256").update(await fs.readFile(voice.path)).digest("hex") !== voice.sha256) throw Error("The saved character voice is missing or changed. Reattach it; no substitute voice was used.");
}
/** Inspector output comes from the exact completed encode graph, not client claims. */
export function verifyCharacterVoiceBundle(entry: Record<string, unknown>, imageCount: number, libraryTokens: number): CharacterRefMember[] {
  const output = (entry.outputs as Record<string, {text?: string[]}>)?.["8"];
  let report: {total_tokens: number; refs: Array<{kind: string; tokens: number; shape: number[]}>};
  try { report = JSON.parse(output?.text?.[0] || ""); } catch { throw Error("The encoder did not return the character/voice bundle verification receipt."); }
  const [visual, audio] = report.refs || [];
  if (report.refs?.length !== 2 || visual?.kind !== "video" || visual.shape?.length !== 5 || visual.shape[2] !== imageCount || audio?.kind !== "audio" || audio.shape?.length !== 4 || audio.shape[1] !== 32 || report.total_tokens !== libraryTokens || report.refs.some(r => !Number.isFinite(r.tokens) || r.tokens <= 0)) throw Error("The saved bundle must contain all approved images and exactly one voice. Source media are kept.");
  return report.refs.map(r => ({kind: r.kind as CharacterRefMember["kind"], tokens: r.tokens, shape: r.shape}));
}
