import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { callStoryCpu, storyCpuAvailable, storyCpuRoot } from "./cpuClient";
import { normalizeStorySpeechText } from "./speechText";
import { validStoryVoice, type StoryLocalSpeechEngine, type StorySpeechVoice } from "./speechVoices";
import { claimStorySpeechJob, createStorySpeechJob, finishStorySpeechJob, getStoryCreatorMessage, getStorySpeechJob, invalidateStorySpeechCache } from "./store";

type Identity = { ownerKey: string; projectId: string; jobId: string };
const modelRevision = { paradee: "ed2934d4df8a4fd891e29584c5e1104649409765", kokoro: "f3ff3571791e39611d31c381e3a41a3af07b4987", bark: "1dbd7a128513b8ae4a4e2130fed57b7ac9da5bcd" };
let queue: Promise<unknown> = Promise.resolve();

export function storySpeechCapabilities() {
  const available = storyCpuAvailable();
  let qualified: Record<string, boolean> = {};
  try { qualified = JSON.parse(fs.readFileSync(path.join(storyCpuRoot(), "qualified.json"), "utf8")); } catch { /* unavailable until functional tests pass */ }
  return { available, transcription: available && qualified.transcription === true,
    embedding: available && qualified.embedding === true,
    engines: { paradee: available && qualified.paradee === true, kokoro: available && qualified.kokoro === true, bark: available && qualified.bark === true },
    defaultEngine: !available ? "browser" : qualified.paradee ? "paradee" : qualified.kokoro ? "kokoro" : qualified.bark ? "bark" : "browser",
    device: "cpu", barkExperimental: true, barkMaxChars: 400, maxChars: 12000 };
}

export function storySpeechPath(input: Identity) {
  const job = getStorySpeechJob(input);
  if (!job) throw new Error("Speech job was not found.");
  const root = process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT;
  if (!root) throw new Error("Story speech storage is not configured.");
  const owner = createHash("sha256").update(input.ownerKey).digest("hex");
  return path.join(root, "story-creator", "speech", owner, `${job.id}.wav`);
}

export function prepareStorySpeech(input: { ownerKey: string; projectId: string; messageId: string;
  engine: StoryLocalSpeechEngine; voice: StorySpeechVoice; retry?: boolean }) {
  if (!validStoryVoice(input.engine, input.voice)) throw new Error("Unsupported local voice selection.");
  const capabilities = storySpeechCapabilities();
  if (!capabilities.engines[input.engine]) throw new Error("This local voice engine has not been qualified on TEST.");
  const message = getStoryCreatorMessage(input);
  const text = normalizeStorySpeechText(message.content);
  if (!text || text.length > capabilities.maxChars) throw new Error("This reply is too long for one read-aloud job. The written reply is unchanged.");
  if (input.engine === "bark" && text.length > capabilities.barkMaxChars) throw new Error("Experimental Bark CPU playback is limited to 400 characters. Choose Paradee or Kokoro for longer replies.");
  const cacheKey = createHash("sha256").update(JSON.stringify([input.messageId, text, input.engine,
    input.voice, modelRevision[input.engine], "speech-format-v1"])).digest("hex");
  const result = createStorySpeechJob({ ...input, cacheKey });
  if (result.job.status === "completed" && !fs.existsSync(storySpeechPath({ ...input, jobId: result.job.id }))) {
    const job = invalidateStorySpeechCache({ ...input, jobId: result.job.id })!;
    if (input.retry) return createStorySpeechJob({ ...input, cacheKey });
    return { job, created: false };
  }
  return result;
}

async function execute(input: Identity) {
  if (!claimStorySpeechJob(input)) return;
  try {
    const job = getStorySpeechJob(input)!;
    const message = getStoryCreatorMessage({ ...input, messageId: job.messageId });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (getStorySpeechJob(input)?.cancelRequested) { finishStorySpeechJob({ ...input, status: "cancelled" }); return; }
      const health = await callStoryCpu<{ busy: boolean }>("/health");
      if (!health.busy) break;
      await delay(500);
    }
    const result = await callStoryCpu<{ audio: string; durationSeconds: number }>("/tts", {
      jobId: input.jobId, text: normalizeStorySpeechText(message.content), engine: job.engine, voice: job.voice,
    }, 600_000);
    if (getStorySpeechJob(input)?.cancelRequested) { finishStorySpeechJob({ ...input, status: "cancelled" }); return; }
    const audio = Buffer.from(result.audio, "base64");
    if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE"
      || !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0) throw new Error("Invalid local speech output.");
    const file = storySpeechPath(input);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.partial`;
    fs.writeFileSync(temp, audio, { mode: 0o600 });
    fs.renameSync(temp, file);
    finishStorySpeechJob({ ...input, status: "completed", durationSeconds: result.durationSeconds });
  } catch {
    const cancelled = getStorySpeechJob(input)?.cancelRequested;
    finishStorySpeechJob({ ...input, status: cancelled ? "cancelled" : "failed",
      error: cancelled ? "Playback generation cancelled." : "Local speech could not finish. Your written reply is unchanged; retry playback when the worker is available." });
  }
}

/** One local TTS operation at a time; no media-GPU lease and no paid fallback. */
export function enqueueStorySpeech(input: Identity) {
  const execution = queue.then(() => execute(input), () => execute(input));
  queue = execution.catch(() => {});
  return execution;
}
