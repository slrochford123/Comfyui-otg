export type VoiceInterval = {start: number; end: number; blockedReason?: string};
export type VoiceLane = {id: string; segments: VoiceInterval[]};
export const MIN_VOICE_LEVEL_DB = -18;
export const MAX_VOICE_LEVEL_DB = 6;

export function speakerIntervalsOverlap(first: VoiceInterval, second: VoiceInterval) {
  return Math.min(first.end, second.end) > Math.max(first.start, second.start);
}

export function voiceIntervalFits(interval: VoiceInterval, duration: number) {
  return Number.isFinite(interval.start) && Number.isFinite(interval.end)
    && interval.start >= 0 && interval.end > interval.start && interval.end <= duration + 0.001;
}

export function labelBlockedVoiceIntervals(lanes: VoiceLane[], reliable: boolean, duration = Infinity) {
  let overlapFound = false;
  for (const lane of lanes) for (const interval of lane.segments) {
    if (!voiceIntervalFits(interval, duration)) {
      interval.blockedReason = "The detected speech interval does not fit this clip.";
    } else if (lanes.some(other => other.id !== lane.id && other.segments.some(turn => speakerIntervalsOverlap(interval, turn)))) {
      interval.blockedReason = "Speech overlaps another speaker in this interval.";
      overlapFound = true;
    } else if (!reliable) interval.blockedReason = "Speaker identity is uncertain in this interval.";
  }
  return overlapFound;
}

function activeWindow(samples: Float32Array, channels: number, sampleRate: number) {
  const size = Math.max(1, Math.round(sampleRate * 0.01)) * channels;
  const frames: number[] = [];
  let peak = 0;
  for (let offset = 0; offset < samples.length; offset += size) {
    const end = Math.min(offset + size, samples.length);
    let sum = 0;
    for (let i = offset; i < end; i++) sum += samples[i] * samples[i];
    const level = Math.sqrt(sum / (end - offset));
    frames.push(level);
    peak = Math.max(peak, level);
  }
  const threshold = Math.max(0.001, peak * 0.08);
  const start = frames.findIndex(level => level >= threshold);
  let end = frames.length - 1;
  while (end >= 0 && frames[end] < threshold) end--;
  return start < 0 ? null : {start: start * size / channels, end: Math.min(samples.length, (end + 1) * size) / channels};
}

export function validateSpeechActivity(speech: Float32Array, converted: Float32Array, channels: number, sampleRate: number) {
  const original = activeWindow(speech, channels, sampleRate);
  const replacement = activeWindow(converted, 1, sampleRate);
  const tolerance = sampleRate * 0.14;
  if (!original || !replacement) return "The speech is too quiet to check its timing.";
  if (Math.abs(original.start - replacement.start) > tolerance || Math.abs(original.end - replacement.end) > tolerance) {
    return "The converted speech starts or ends too far from the original line.";
  }
  return "";
}

// Build the proposed delta in a scratch buffer so a failed edit never changes
// a single sample of the original soundtrack or of any accepted edit.
export function replaceDialoguePcm(original: Float32Array, speech: Float32Array, converted: Float32Array,
  result: Float32Array, start: number, end: number, channels: number, sampleRate: number, levelDb = 0) {
  if (!Number.isFinite(levelDb) || levelDb < MIN_VOICE_LEVEL_DB || levelDb > MAX_VOICE_LEVEL_DB) {
    return "The selected voice level is out of range.";
  }
  const length = end - start;
  if (length <= 0) return "The edit is outside the video.";
  if (!converted.length) return "The converter returned no audible take.";
  let lastAudible = converted.length - 1;
  while (lastAudible >= 0 && Math.abs(converted[lastAudible]) < 0.001) lastAudible--;
  if (lastAudible >= length + 0.01 * sampleRate) return "The converted line runs past the original speech window.";
  const targetPower = converted.subarray(0, length).reduce((sum, value) => sum + value * value, 0);
  if (targetPower < 0.000001 || !Number.isFinite(targetPower)) return "The converter returned a silent or invalid take.";
  const gains = Array.from({length: channels}, (_, channel) => {
    let sourcePower = 0;
    for (let frame = start; frame < end; frame++) sourcePower += speech[frame * channels + channel] ** 2;
    return Math.sqrt(sourcePower / targetPower);
  });
  const strongest = Math.max(...gains);
  if (!Number.isFinite(strongest) || strongest > 8 || strongest < 0.125) return "The converted loudness differs too much from the original line.";
  const level = 10 ** (levelDb / 20);
  const fadeFrames = Math.max(1, Math.min(Math.round(0.012 * sampleRate), Math.floor(length / 4)));
  const candidate = new Float32Array(length * channels);
  for (let frame = 0; frame < length; frame++) {
    const mask = Math.min(1, frame / fadeFrames, (length - 1 - frame) / fadeFrames);
    for (let channel = 0; channel < channels; channel++) {
      const index = (start + frame) * channels + channel;
      const sample = original[index] + mask * ((converted[frame] || 0) * gains[channel] * level - speech[index]);
      if (!Number.isFinite(sample) || Math.abs(sample) > 1.0001) return "The replacement would clip the original soundtrack.";
      candidate[frame * channels + channel] = sample;
    }
  }
  result.set(candidate, start * channels);
  return "";
}
