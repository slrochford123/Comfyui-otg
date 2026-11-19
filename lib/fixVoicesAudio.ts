import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runtimePath } from "@/lib/runtime/configPaths";
import { RequestError } from "@/lib/requestError";
import { replaceDialoguePcm, validateSpeechActivity, voiceIntervalFits, type VoiceInterval } from "@/lib/fixVoicesDsp";
import { fineTuneSceneVoice, matchVoiceScene, SCENE_MATCH_VERSION, type SceneFineTune, type SceneMatchReport } from "@/lib/fixVoicesSceneMatch";
export type { VoiceInterval } from "@/lib/fixVoicesDsp";

const run = promisify(execFile);
const ffmpeg = process.env.OTG_FFMPEG_BIN || "ffmpeg";
const ffprobe = process.env.OTG_FFPROBE_BIN || "ffprobe";
const sampleRate = 48000;
const maxChannels = 2;

export type MixSource = { duration: number; channels: number; original: string; speech: string; effects?: string; music?: string };
export type MixEdit = VoiceInterval & { audioPath: string; take?: boolean; levelDb?: number; fineTune?: SceneFineTune };

export async function inspectCorrectionClip(file: string, shortClip: boolean) {
  const { stdout } = await run(ffprobe, ["-v", "error", ...videoLimits, "-show_entries", "format=duration:stream=codec_type,duration,start_time,channels", "-of", "json", file], {timeout: 30_000})
    .catch(() => { throw new RequestError("Choose a readable video with an audio track.", 422); });
  const probe = JSON.parse(stdout);
  const streams = (probe.streams || []) as {codec_type: string; duration?: string; channels?: number; start_time?: string}[];
  const video = streams.find(stream => stream.codec_type === "video");
  const audio = streams.find(stream => stream.codec_type === "audio");
  const duration = Number(video?.duration || probe.format?.duration);
  if (!video || !audio || !Number.isFinite(duration) || duration <= 0) throw new RequestError("Choose a readable video with an audio track.", 422);
  if (shortClip && (duration < 3.95 || duration > 12.05)) throw new RequestError("Choose a video approximately 4 to 12 seconds long.", 422);
  const channels = Number(audio.channels);
  if (!Number.isInteger(channels) || channels < 1 || channels > maxChannels) throw new RequestError("This clip has an unsupported soundtrack layout. Choose a mono or stereo clip.", 422);
  const offset = Number(audio.start_time || 0) - Number(video.start_time || 0);
  if (!Number.isFinite(offset) || Math.abs(offset) > 1) throw new RequestError("The soundtrack has an unusual starting offset. The original was preserved.", 422);
  return {duration, channels, offset};
}

export async function extractCorrectionSoundtrack(file: string, workDir: string, shortClip: boolean) {
  const { duration, channels, offset } = await inspectCorrectionClip(file, shortClip);
  const original = path.join(workDir, "original-soundtrack.wav");
  const offsetFilter = offset > 0
    ? `adelay=${Math.round(offset * sampleRate)}S:all=1,`
    : offset < 0 ? `atrim=start=${-offset},asetpts=PTS-STARTPTS,` : "";
  await run(ffmpeg, ["-v", "error", "-nostdin", "-y", ...videoLimits, "-i", file, "-map", "0:a:0", "-af", `${offsetFilter}apad`, "-t", String(duration), "-ar", String(sampleRate), "-ac", String(channels), "-c:a", "pcm_f32le", original], {timeout: 60_000});
  return {duration, channels, original};
}

export async function separateCorrectionSoundtrack(source: Omit<MixSource, "speech">, workDir: string, signal: AbortSignal): Promise<MixSource> {
  const configFile = process.env.OTG_AUDIO_ENGINE_CONFIG || runtimePath("unified-audio", "engines.json");
  const config = JSON.parse(await fs.readFile(configFile, "utf8"));
  if (config.verified?.["separate-bandit"]?.cpu !== true) throw new Error("CPU cinematic separation is unavailable.");
  const separationDir = path.join(workDir, "bandit");
  await fs.mkdir(separationDir, {mode: 0o700});
  const manifest = path.join(separationDir, "request.json");
  await fs.writeFile(manifest, JSON.stringify({ id: path.basename(workDir), operation: "separate", gpu: "cpu", source: source.original, params: { engine: "bandit" } }), {mode: 0o600});
  await run(config.python, [process.env.OTG_AUDIO_WORKER_SCRIPT || path.join(process.cwd(), "scripts", "audio-editing-worker.py"), manifest], {
    signal, timeout: 240_000, maxBuffer: 2_000_000,
    env: {...process.env, CUDA_VISIBLE_DEVICES: "", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", OMP_NUM_THREADS: "2", OTG_AUDIO_ENGINE_CONFIG: configFile},
  });
  const output = { ...source, speech: path.join(separationDir, "speech.wav"), effects: path.join(separationDir, "effects.wav"), music: path.join(separationDir, "music.wav") };
  for (const file of [output.speech, output.effects, output.music]) await fs.access(file);
  return output;
}

async function readPcm(file: string, channels: number, maximumDuration: number, sampleLimit?: number) {
  const args = ["-v", "error", "-nostdin", ...audioLimits, "-i", file, "-map", "0:a:0", "-t", String(maximumDuration), "-ar", String(sampleRate), "-ac", String(channels), "-f", "f32le", "pipe:1"];
  const { stdout } = await run(ffmpeg, args, { encoding: "buffer", timeout: 120_000, maxBuffer: Math.ceil(maximumDuration * sampleRate * channels * 4) + 100_000 });
  const samples = Math.floor(stdout.length / 4);
  const pcm = new Float32Array(sampleLimit ?? samples);
  for (let i = 0; i < Math.min(samples, pcm.length); i++) pcm[i] = stdout.readFloatLE(i * 4);
  return pcm;
}

export type CorrectionMixer = Awaited<ReturnType<typeof openCorrectionMixer>>;
export async function openCorrectionMixer(source: MixSource) {
  const { channels, duration } = source;
  const sampleCount = Math.round(duration * sampleRate) * channels;
  const readSource = async (file: string) => {
    if (!source.effects || !source.music) return readPcm(file, channels, duration, sampleCount);
    const decoded = await readPcm(file, channels, duration + 0.1);
    if (decoded.length !== sampleCount) throw new RequestError("A separated track does not match the source duration. The original was preserved.", 422);
    return decoded;
  };
  const [original, speech, effects, music] = await Promise.all([
    readSource(source.original),
    readSource(source.speech),
    source.effects ? readSource(source.effects) : undefined,
    source.music ? readSource(source.music) : undefined,
  ]);
  const result = original.slice();

  function bounds(interval: VoiceInterval) {
    return { start: Math.max(0, Math.round(interval.start * sampleRate)), end: Math.min(sampleCount / channels, Math.round(interval.end * sampleRate)) };
  }

  function rejectInterval(interval: VoiceInterval) {
    if (!voiceIntervalFits(interval, duration)) return "The selected speech interval does not fit this clip.";
    const {start, end} = bounds(interval);
    if (end - start < sampleRate * 0.18) return "Speech is too short to isolate reliably.";
    let speechPower = 0, residualPower = 0, residualCorrelation = 0, reconstructionPower = 0;
    for (let i = start * channels; i < end * channels; i++) {
      const s = speech[i];
      const residual = original[i] - s;
      const reconstruction = residual - (effects?.[i] || 0) - (music?.[i] || 0);
      speechPower += s * s;
      residualPower += residual * residual;
      residualCorrelation += s * residual;
      reconstructionPower += reconstruction * reconstruction;
    }
    const rms = Math.sqrt(speechPower / ((end - start) * channels));
    if (!Number.isFinite(rms) || rms < 0.0006) return "The isolated dialogue level is too low to convert reliably.";
    if (Math.abs(residualCorrelation) / speechPower > 0.35 && Math.abs(residualCorrelation) / Math.sqrt(speechPower * residualPower) > 0.30) return "The residual soundtrack may still contain this voice.";
    if (effects && music && reconstructionPower / speechPower > 0.5) return "The separated tracks do not reconstruct this line closely enough.";
    return "";
  }

  const editedIntervals: {start: number; end: number}[] = [];
  async function applyEdit(edit: MixEdit, matchOriginalScene: boolean): Promise<{reason: string; sceneMatch?: SceneMatchReport; fineTuneWarning?: string}> {
    const {start, end} = bounds(edit);
    const length = end - start;
    if (length <= 0) return {reason: "The edit is outside the video."};
    if (editedIntervals.some(interval => interval.start < end && start < interval.end)) return {reason: "This interval would overwrite another correction."};
    const converted = await readPcm(edit.audioPath, 1, length / sampleRate + 0.3);
    const originalCue = speech.subarray(start * channels, end * channels);
    const timingIssue = source.effects && source.music
      ? validateSpeechActivity(originalCue, converted, channels, sampleRate)
      : "";
    if (timingIssue) return {reason: timingIssue};
    const mix = (samples: Float32Array) => replaceDialoguePcm(original, speech, samples, result, start, end, channels, sampleRate, edit.levelDb);
    const reason = mix(converted);
    if (reason) return {reason};
    let sceneMatch: SceneMatchReport | undefined;
    let fineTuneWarning: string | undefined;
    if (matchOriginalScene) {
      const matched = matchVoiceScene(originalCue, original.subarray(start * channels, end * channels), channels, converted, sampleRate);
      sceneMatch = matched.report;
      if (sceneMatch.status === "matched") {
        const issue = validateSpeechActivity(originalCue, matched.samples, channels, sampleRate) || mix(matched.samples);
        if (issue) sceneMatch = {version: SCENE_MATCH_VERSION, status: "standard", reason: issue};
      }
      if (edit.fineTune?.distance || edit.fineTune?.reflections) {
        const base = sceneMatch.status === "matched" ? matched : {samples: converted, report: sceneMatch};
        const adjusted = fineTuneSceneVoice(base, edit.fineTune, length, sampleRate);
        const issue = validateSpeechActivity(originalCue, adjusted, channels, sampleRate) || mix(adjusted);
        if (issue) fineTuneWarning = "Fine-Tune could not fit this line safely. The previous acoustic match was used.";
      }
    }
    editedIntervals.push({start, end});
    return {reason: "", sceneMatch, fineTuneWarning};
  }

  async function write(file: string) {
    const raw = path.join(path.dirname(file), "corrected-pcm.f32");
    const bytes = Buffer.alloc(result.length * 4);
    for (let i = 0; i < result.length; i++) bytes.writeFloatLE(result[i], i * 4);
    await fs.writeFile(raw, bytes, {mode: 0o600});
    try {
      await run(ffmpeg, ["-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", String(sampleRate), "-ac", String(channels), "-i", raw, "-c:a", "pcm_f32le", file], {timeout: 120_000});
    } finally { await fs.unlink(raw).catch(() => undefined); }
  }

  return {
    rejectInterval,
    apply: async (edit: MixEdit) => (await applyEdit(edit, false)).reason,
    applySceneMatched: (edit: MixEdit) => applyEdit(edit, true),
    write,
  };
}

const videoLimits = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi"];
const audioLimits = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "wav,mp3,flac,ogg,mov,matroska,webm,aac"];

export async function extractCorrectionLine(file: string, interval: VoiceInterval, output: string) {
  await run(ffmpeg, ["-v", "error", "-nostdin", "-y", ...audioLimits, "-i", file, "-ss", String(interval.start), "-t", String(interval.end - interval.start), "-map", "0:a:0", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", output], {timeout: 30_000});
}

export async function prepareActedTake(file: string, workDir: string) {
  const take = path.join(workDir, "acted-take.wav");
  const {stdout} = await run(ffprobe, ["-v", "error", ...audioLimits, "-show_entries", "format=duration:stream=codec_type", "-of", "json", file], {timeout: 15_000});
  const info = JSON.parse(stdout);
  const duration = Number(info.format?.duration);
  if (!info.streams?.some((stream: {codec_type: string}) => stream.codec_type === "audio") || (Number.isFinite(duration) && (duration < 0.18 || duration > 12.5))) {
    throw new RequestError("Record or upload one clear line of up to 12 seconds.", 422);
  }
  await run(ffmpeg, ["-v", "error", "-nostdin", "-y", ...audioLimits, "-i", file, "-map", "0:a:0", "-t", "12.6", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", take], {timeout: 30_000});
  const samples = await readPcm(take, 1, 12.61);
  if (samples.length > 12.5 * sampleRate || samples.length < 0.18 * sampleRate) throw new RequestError("Record or upload one clear line of up to 12 seconds.", 422);
  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  if (peak < 0.003) throw new RequestError("This take is too quiet to use. Record again closer to the microphone.", 422);
  return take;
}

type VideoPacket = { pts_time?: string; dts_time?: string; duration_time?: string; data_hash: string };
async function picturePackets(file: string): Promise<VideoPacket[]> {
  const {stdout} = await run(ffprobe, ["-v", "error", ...videoLimits, "-select_streams", "v:0", "-show_packets", "-show_data_hash", "sha256", "-show_entries", "packet=pts_time,dts_time,duration_time,data_hash", "-of", "json", file], {timeout: 30_000, maxBuffer: 2_000_000});
  return JSON.parse(stdout).packets || [];
}

export async function muxCorrectionVideo(original: string, corrected: string, destination: string) {
  const webm = destination.endsWith(".webm");
  await run(ffmpeg, ["-v", "error", "-nostdin", "-y", ...videoLimits, "-i", original, ...audioLimits, "-i", corrected, "-map", "0:v:0", "-map", "1:a:0", "-map_metadata", "0", "-c:v", "copy", "-c:a", webm ? "libopus" : "aac", "-b:a", "192k", ...(!webm ? ["-movflags", "+faststart"] : []), destination], {timeout: 90_000});
  const [source, output] = await Promise.all([picturePackets(original), picturePackets(destination)]);
  const offset = Number(output[0]?.pts_time) - Number(source[0]?.pts_time);
  if (!source.length || output.length !== source.length || source.some((packet, index) => {
    const rendered = output[index];
    return !packet.data_hash || packet.data_hash !== rendered.data_hash || ["pts_time", "dts_time"].some(key => {
      const field = key as "pts_time" | "dts_time";
      const originalTime = Number(packet[field]);
      const renderedTime = Number(rendered[field]);
      return Number.isFinite(originalTime) && (!Number.isFinite(renderedTime) || Math.abs(renderedTime - offset - originalTime) > 0.004);
    });
  })) throw new RequestError("The corrected copy could not preserve the video packets and timing. The original is available.", 422);
}

export type ObservedWord = {text: string; start: number; end: number; probability: number};
export async function transcribeCorrectionLines(inputs: string[], signal: AbortSignal): Promise<ObservedWord[][]> {
  if (!inputs.length) return [];
  const configFile = process.env.OTG_AUDIO_ENGINE_CONFIG || runtimePath("unified-audio", "engines.json");
  const config = JSON.parse(await fs.readFile(configFile, "utf8"));
  const model = config.whisper?.model || path.join(path.dirname(path.dirname(config.bandit.checkpoint)), "faster-whisper-small");
  await fs.access(path.join(model, "model.bin"));
  const {stdout} = await run(config.python, [path.join(process.cwd(), "scripts", "voice", "fix_voices_transcript.py"), model, ...inputs], {
    signal, timeout: 90_000, maxBuffer: 1_000_000,
    env: {...process.env, CUDA_VISIBLE_DEVICES: "", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", OMP_NUM_THREADS: "2"},
  });
  const lines: unknown = JSON.parse(stdout);
  if (!Array.isArray(lines) || lines.length !== inputs.length || lines.some(words => !Array.isArray(words) || words.some(word =>
    !word || typeof word.text !== "string" || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end < word.start
    || !Number.isFinite(word.probability) || word.probability < 0 || word.probability > 1))) {
    throw new Error("The installed transcript tool returned invalid word timing.");
  }
  return lines;
}

export function correctionWords(text: string) {
  return text.normalize("NFKC").toLocaleLowerCase().match(/[\p{Letter}\p{Number}]+/gu)?.join("") || "";
}

export function confidenceInWords(words: ObservedWord[]) {
  return words.length > 0 && words.every(word => Number.isFinite(word.probability) && Number.isFinite(word.start) && Number.isFinite(word.end))
    && words.reduce((total, word) => total + word.probability, 0) / words.length >= 0.76;
}

export function compareObservedSpeech(source: ObservedWord[] | undefined, converted: ObservedWord[] | undefined) {
  if (!source || !converted || !confidenceInWords(source) || !confidenceInWords(converted)) {
    return { warning: "Some words could not be checked automatically. Compare both tracks before saving." };
  }
  if (source.length !== converted.length || source.some((word, index) => correctionWords(word.text) !== correctionWords(converted[index].text))) {
    return { reason: "The converter changed or dropped words. This line kept its original audio." };
  }
  if (source.some((word, index) => Math.abs(word.start - converted[index].start) > 0.1 || Math.abs(word.end - converted[index].end) > 0.1)) {
    return { reason: "The converted words no longer fit the original timing. This line kept its original audio." };
  }
  return {};
}

export async function alignActedTake(originalLine: string, take: string, output: string, signal: AbortSignal) {
  const [sourceWords, takeWords] = await transcribeCorrectionLines([originalLine, take], signal).catch(() => []);
  if (!sourceWords || !takeWords || !confidenceInWords(sourceWords) || !confidenceInWords(takeWords)
      || sourceWords.length !== takeWords.length || sourceWords.some((word, i) => correctionWords(word.text) !== correctionWords(takeWords[i].text))) {
    throw new RequestError("The recorded take could not be matched to the words in this line. Follow the original cue and record again.", 422);
  }
  const originalStart = sourceWords[0].start;
  const takeStart = takeWords[0].start;
  const sourceSpan = sourceWords[sourceWords.length - 1].end - originalStart;
  const takeSpan = takeWords[takeWords.length - 1].end - takeStart;
  const rate = takeSpan / sourceSpan;
  if (!Number.isFinite(rate) || rate < 0.90 || rate > 1.10 || sourceWords.some((word, i) =>
    Math.abs(word.start - originalStart - (takeWords[i].start - takeStart) / rate) > 0.08
    || Math.abs(word.end - originalStart - (takeWords[i].end - takeStart) / rate) > 0.08)) {
    throw new RequestError("This take is too far from the mouth timing. Replay the cue and record again.", 422);
  }
  const inputStart = Math.max(0, takeStart - 0.03);
  const delay = Math.max(0, Math.round((originalStart - (takeStart - inputStart) / rate) * 44100));
  const inputEnd = takeWords[takeWords.length - 1].end + 0.04;
  await run(ffmpeg, ["-v", "error", "-nostdin", "-y", ...audioLimits, "-i", take, "-af", `atrim=start=${inputStart}:end=${inputEnd},asetpts=PTS-STARTPTS,atempo=${rate},adelay=${delay}S:all=1`, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", output], {timeout: 30_000});
  return output;
}
