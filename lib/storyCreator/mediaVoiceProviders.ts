import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { extractAudioFromHistory, readWorkflowJson } from "@/lib/comfyVoices";
import { prepareWorkflowForTarget } from "@/lib/comfyWorkflowCompatibility";
import { patchProviderWorkflow } from "@/lib/ltxVoiceCreatorWorkflow";
import { buildVoiceCreatorPrompt, listVoiceCreatorPresets } from "@/lib/voiceCreatorCatalog";
import { enqueueComfyMedia, getMediaQueueJob } from "@/lib/workers/mediaGpuQueue";
import { reserveStoryVoiceRequest, type StoryMediaRecord } from "./mediaStore";

export const storyVoiceAutoProfile = "story-voice-auto";
export const storyLtxVoiceProfile = "ltx25-story";
const maxCloudCharacters = 400;
const maxAudioBytes = 8 * 1024 * 1024;

export function storyVoiceAutoEnabled() {
  return process.env.OTG_STORY_ELEVENLABS === "1" &&
    (process.env.OTG_ENV === "test" || process.env.OTG_ENV === "prod");
}

export function elevenLabsKey() {
  if (!storyVoiceAutoEnabled()) return "";
  const file = process.env.OTG_STORY_ELEVENLABS_KEY_FILE;
  if (!file || !path.isAbsolute(file)) return "";
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.mode & 0o077 || info.size > 256 ||
        (info.uid !== 0 && info.uid !== process.getuid?.())) return "";
    const key = fs.readFileSync(file, "utf8").trim();
    return /^[A-Za-z0-9_-]{16,250}$/.test(key) ? key : "";
  } catch {
    return "";
  }
}

export function storyElevenLabsConfigured() {
  return Boolean(elevenLabsKey());
}

function rejected(message: string) {
  const error = new Error(message);
  error.name = "RejectedStoryMedia";
  return error;
}

export class ElevenLabsRejection extends Error {
  constructor(readonly status: number) {
    super(status === 429 ? "ElevenLabs is busy or has reached its credit limit." :
      "ElevenLabs declined the voice request.");
  }
}

async function elevenLabs(endpoint: string, key: string, body: object) {
  const response = await fetch("https://api.elevenlabs.io/v1/" + endpoint, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(45_000),
    headers: { "Content-Type": "application/json", "xi-api-key": key },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ElevenLabsRejection(response.status);
  }
  return response;
}

function validVoiceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,120}$/.test(value);
}

export async function writeStoryVoiceWav(root: string, name: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > maxAudioBytes) throw Error("The voice provider returned unusable audio.");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const temporary = path.join(root, name + ".input");
  const result = path.join(root, name + ".wav");
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  try {
    const run = await runCmd(resolveFfmpegPath(), [
      "-nostdin", "-v", "error", "-y", "-i", temporary, "-map", "0:a:0",
      "-t", "90", "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", result,
    ], { timeoutMs: 30_000 });
    if (run.code !== 0 || fs.statSync(result).size < 2500) throw Error("The voice provider returned unusable audio.");
    return result;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export async function renderStoryElevenLabs(record: StoryMediaRecord, root: string, approvedId?: string, reuse=false) {
  const key = elevenLabsKey();
  if (!key) return { reason: "ElevenLabs is unavailable on this server." } as const;
  if (!validVoiceId(approvedId) && (approvedId || reuse || record.command.voiceMode === "reuse"))
    return { reason: "This reference has no approved ElevenLabs voice." } as const;
  const text = record.command.text.trim();
  if (!text || text.length > maxCloudCharacters)
    return { reason: "This line exceeds the ElevenLabs limit of 400 characters." } as const;
  // Voice Design requires at least 100 characters. Repeat the exact line for
  // a short audition and show the actual audition script in the app.
  let audition = text;
  if (!approvedId) while (audition.length < 100) audition += "\n" + text;
  if (!reserveStoryVoiceRequest(record, !approvedId))
    return { reason: "The ElevenLabs usage or voice limit has been reached." } as const;
  if (approvedId && validVoiceId(approvedId)) {
    const response = await elevenLabs("text-to-speech/" + approvedId + "?output_format=mp3_44100_128", key, {
      text, model_id: "eleven_multilingual_v2",
    });
    const file = await writeStoryVoiceWav(root, "eleven-dialogue", Buffer.from(await response.arrayBuffer()));
    return { file, providerVoiceId: approvedId } as const;
  }
  const description = ("Clean studio speech, single speaker. " + record.command.prompt).slice(0, 1000);
  const response = await elevenLabs("text-to-voice/design", key, {
    model_id: "eleven_ttv_v3", voice_description: description, text: audition, auto_generate_text: false,
  });
  const payload = await response.json();
  if (!Array.isArray(payload.previews)) throw Error("ElevenLabs returned no voice previews.");
  const previews: { id: string; file: string }[] = [];
  for (const preview of payload.previews.slice(0, 3)) {
    if (!validVoiceId(preview?.generated_voice_id) || typeof preview?.audio_base_64 !== "string" ||
        preview.audio_base_64.length > Math.ceil(maxAudioBytes * 4 / 3)) continue;
    const file = await writeStoryVoiceWav(root, "eleven-preview-" + (previews.length + 1), Buffer.from(preview.audio_base_64, "base64"))
      .catch(() => null);
    if (file) previews.push({ id: preview.generated_voice_id, file });
  }
  if (!previews.length) throw Error("ElevenLabs returned no playable voice previews.");
  return { file: previews[0].file, previews, audition, description } as const;
}

export async function createStoryElevenLabsVoice(name: string, description: string, previewId: string) {
  const key = elevenLabsKey();
  if (!key || !validVoiceId(previewId)) throw Error("ElevenLabs approval is unavailable.");
  const response = await elevenLabs("text-to-voice", key, {
    voice_name: name.slice(0, 80), voice_description: description, generated_voice_id: previewId,
  });
  const payload = await response.json();
  if (!validVoiceId(payload.voice_id)) throw Error("ElevenLabs did not confirm the saved voice.");
  return payload.voice_id;
}

export function storyLtxPreset(direction: string) {
  const natural = listVoiceCreatorPresets("ltx25", "natural");
  if (/\brussia(?:n)?\b/i.test(direction)) return natural.find(preset => preset.label === "Russia")!;
  return natural.find(preset => preset.label.length >= 4 && direction.toLowerCase().includes(preset.label.toLowerCase())) || natural[0];
}

export async function enqueueStoryLtxVoice(record: StoryMediaRecord, direction: string, bind: (job: { engine: string; promptId: string; comfyBaseUrl: string }) => void) {
  const text = record.command.text.trim();
  if (text.length > 220) throw rejected("The LTX voice audition supports up to 220 characters. Split this line and try again.");
  const base = (process.env.OTG_MEDIA_3090_IMAGE_URL || "http://100.75.162.64:8188").replace(/\/+$/, "");
  const preset = storyLtxPreset(direction);
  const presentation = /\b(?:female|woman|lady)\b/i.test(direction) ? "female" :
    /\b(?:male|man|gentleman)\b/i.test(direction) ? "male" : "unspecified";
  const prompt = buildVoiceCreatorPrompt({
    provider: "ltx25", library: "natural", preset, presentation,
    age: /\b(?:elderly|senior)\b/i.test(direction) ? "elderly" : "adult",
    sampleText: text,
  });
  const graph = patchProviderWorkflow({
    workflow: await readWorkflowJson("internal/voices/ltx25_audio.json"), provider: "ltx25",
    prompt: prompt + " Voice direction: " + direction.slice(0, 500),
    durationSeconds: text.length > 65 ? 10 : 5,
    seed: randomInt(0, 2 ** 32), outputPrefix: "audio/story-voice/" + record.id + "/audition",
  });
  const prepared = prepareWorkflowForTarget(graph, "3090-local");
  await enqueueComfyMedia({
    baseUrl: base, workerId: "comfy-voices",
    body: { prompt: prepared.workflow, client_id: "story-ltx-voice-" + record.id },
  }, promptId => bind({ engine: "ltx25", promptId, comfyBaseUrl: base }));
}

export async function collectStoryLtxVoice(record: StoryMediaRecord, root: string) {
  const job = record.backendJob;
  if (!job || job.engine !== "ltx25") return null;
  const queue = getMediaQueueJob(job.promptId);
  if (queue?.status === "failed" || queue?.status === "canceled")
    return { status: queue.status, error: queue.error || "The local voice did not finish." } as const;
  if (queue?.status === "unknown") return { stage: "Checking the original LTX voice job" } as const;
  if (queue?.status !== "completed") return { stage: queue?.status === "queued" ? "Waiting for RTX 3090" : "Generating with local LTX 2.5" } as const;
  const base = String(job.comfyBaseUrl);
  const response = await fetch(base + "/history/" + encodeURIComponent(job.promptId), { signal: AbortSignal.timeout(8000), redirect: "error" });
  if (!response.ok) return null;
  const receipt = (await response.json())[job.promptId];
  const output = extractAudioFromHistory({outputs: {"455": receipt?.outputs?.["455"]}})[0];
  if (!output || output.subfolder !== "audio/story-voice/" + record.id || !/^[\w.-]+$/.test(output.filename))
    return { status: "failed", error: "LTX 2.5 did not return the expected audition file." } as const;
  const query = new URLSearchParams({filename: output.filename, subfolder: output.subfolder, type: "output"});
  const media = await fetch(base + "/view?" + query, { signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!media.ok) return null;
  return { file: await writeStoryVoiceWav(root, "ltx-dialogue", Buffer.from(await media.arrayBuffer())) } as const;
}
