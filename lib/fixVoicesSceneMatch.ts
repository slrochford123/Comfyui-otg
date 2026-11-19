export const SCENE_MATCH_VERSION = 1;
export const MAX_SCENE_FINE_TUNE = 3;
export type SceneFineTune = {distance: number; reflections: number};

type Powers = {total: number; bands: number[]};
export type SceneMatchReport = {
  version: number;
  status: "matched" | "standard";
  reason?: string;
  commonSpeechMs?: number;
  dynamicsDb?: number;
  eqDb?: number[];
  reflections?: {decayMs: number; wetDb: number; observations: number};
};
type SceneMatch = {samples: Float32Array; report: SceneMatchReport; direct?: Float32Array};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const db = (power: number) => 10 * Math.log10(Math.max(power, 1e-12));
const gain = (value: number) => 10 ** (value / 20);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const rounded = (value: number) => Math.round(value * 100) / 100;
const median = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
};

function bandsFor(samples: Float32Array, sampleRate: number) {
  const bands = [new Float32Array(samples.length), new Float32Array(samples.length), new Float32Array(samples.length)];
  const slow = 1 - Math.exp(-2 * Math.PI * 600 / sampleRate);
  const fast = 1 - Math.exp(-2 * Math.PI * 2400 / sampleRate);
  let low = 0, upper = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    low += slow * (sample - low);
    upper += fast * (sample - upper);
    bands[0][i] = low;
    bands[1][i] = upper - low;
    bands[2][i] = sample - upper;
  }
  return bands;
}

function frames(samples: Float32Array, bands: Float32Array[], hop: number): Powers[] {
  const output: Powers[] = [];
  for (let offset = 0; offset + hop <= samples.length; offset += hop) {
    let total = 0;
    const power = [0, 0, 0];
    for (let i = offset; i < offset + hop; i++) {
      total += samples[i] ** 2;
      for (let band = 0; band < bands.length; band++) power[band] += bands[band][i] ** 2;
    }
    output.push({total: total / hop, bands: power.map(value => value / hop)});
  }
  return output;
}

function observedReflections(reference: number[], dry: number[], bed: number[], peak: number, dryPeak: number) {
  const observations: Array<{decayMs: number; wet: number}> = [];
  for (let i = 4; i + 8 <= dry.length; i++) {
    if (dry[i - 1] < dryPeak * 0.025 || dry.slice(i, i + 8).some(power => power > dryPeak * 0.003)) continue;
    const tail = reference.slice(i + 2, i + 8);
    const before = mean(reference.slice(i - 4, i));
    const confidenceFloor = Math.max(peak * 0.004, mean(bed.slice(i - 4, i)) * 32, 3e-7);
    if (before < confidenceFloor || tail[0] < before * 0.003 || tail[0] > before * 0.22) continue;
    if (tail.some((power, offset) => power < Math.max(3e-9, bed[i + 2 + offset] * 5))) continue;
    const levels = tail.map(db);
    const decay = mean(levels.slice(0, 2)) - mean(levels.slice(-2));
    if (decay < 7 || decay > 24 || levels.slice(1).filter((level, index) => level > levels[index] + 1).length > 1) continue;
    observations.push({decayMs: 60 * 80 / decay, wet: Math.sqrt(tail[0] / before)});
    i += 7;
  }
  if (observations.length < 2) return undefined;
  const decays = observations.map(item => item.decayMs);
  if (Math.max(...decays) / Math.min(...decays) > 1.7) return undefined;
  const wet = clamp(median(observations.map(item => item.wet)) * 0.7, 0.035, 0.13);
  return {decayMs: rounded(clamp(median(decays), 180, 460)), wetDb: rounded(20 * Math.log10(wet)), observations: observations.length};
}

/**
 * Compare just the overlapping, usable speech. The scene bed is a confidence
 * signal and is never a source of replacement audio. There is no pitch or
 * timing transformation.
 */
export function matchVoiceScene(speech: Float32Array, original: Float32Array, channels: number,
  converted: Float32Array, sampleRate: number): SceneMatch {
  const fallback = (reason: string, commonSpeechMs?: number) => ({
    samples: converted, report: {version: SCENE_MATCH_VERSION, status: "standard" as const, reason, commonSpeechMs},
  });
  const count = speech.length / channels;
  const hop = Math.round(sampleRate * 0.02);
  if (count < sampleRate * 0.5 || !converted.length) return fallback("Too little speech for a scene profile.");
  const source = new Float32Array(count);
  const dry = new Float32Array(count);
  dry.set(converted.subarray(0, count));
  const bed = new Array<number>(Math.floor(count / hop)).fill(0);
  for (let frame = 0; frame < count; frame++) {
    const block = Math.floor(frame / hop);
    for (let channel = 0; channel < channels; channel++) {
      const index = frame * channels + channel;
      source[frame] += speech[index] / channels;
      if (block < bed.length) bed[block] += (original[index] - speech[index]) ** 2 / (hop * channels);
    }
  }
  const dryBands = bandsFor(dry, sampleRate);
  const refFrames = frames(source, bandsFor(source, sampleRate), hop);
  const dryFrames = frames(dry, dryBands, hop);
  const reference = refFrames.map(frame => frame.total);
  const replacement = dryFrames.map(frame => frame.total);
  const peak = Math.max(...reference);
  const dryPeak = Math.max(...replacement);
  if (!Number.isFinite(peak + dryPeak) || peak < 1e-7 || dryPeak < 1e-7) return fallback("Speech level is too low or invalid.");
  const paired = reference.flatMap((power, index) =>
    power >= peak * 0.009 && replacement[index] >= dryPeak * 0.009 ? [index] : []);
  const active = paired.filter(index => bed[index] * 32 < reference[index]);
  const commonSpeechMs = active.length * 20;
  if (commonSpeechMs < 460) return fallback("Too little clean aligned speech for a scene profile.", commonSpeechMs);
  if (active.length < paired.length * 0.80) return fallback("Background dominates too much of this cue.", commonSpeechMs);

  const smoothDb = (values: number[], index: number) =>
    db(mean(values.slice(Math.max(0,index - 2), index + 3)));
  const refLevel = active.map(index => smoothDb(reference, index));
  const dryLevel = active.map(index => smoothDb(replacement, index));
  const refCenter = mean(refLevel);
  const dryCenter = mean(dryLevel);
  const covariance = refLevel.reduce((sum, value, i) => sum + (value - refCenter) * (dryLevel[i] - dryCenter), 0);
  const norm = (values: number[], center: number) => Math.hypot(...values.map(value => value - center));
  const correlation = covariance / (norm(refLevel, refCenter) * norm(dryLevel, dryCenter));
  if (!Number.isFinite(correlation) || correlation < 0.48) return fallback("Converted and original dynamics do not align reliably.", commonSpeechMs);

  const eqDb = [0, 1, 2].map(band => {
    const comparisons = active.flatMap(index => {
      const fraction = (frame: Powers) => frame.bands[band] / frame.total;
      const a = fraction(refFrames[index]), b = fraction(dryFrames[index]);
      return a >= 0.032 && b >= 0.032 ? [db(a) - db(b)] : [];
    });
    if (comparisons.length < active.length * 0.55) return 0;
    const typical = median(comparisons);
    const agreeing = comparisons.filter(value => Math.sign(value) === Math.sign(typical)).length;
    return agreeing >= comparisons.length * 0.72 ? clamp(typical * 0.30, -1.5, 1.5) : 0;
  });
  const voiceGain = new Array(reference.length).fill(0);
  const offsetDb = median(refLevel.map((value, i) => value - dryLevel[i]));
  for (const [j, i] of active.entries()) {
    voiceGain[i] = clamp((refLevel[j] - dryLevel[j] - offsetDb) * 0.50, -2.5, 2.5);
  }
  const motion = voiceGain.map((_, i) => mean(voiceGain.slice(Math.max(0, i - 1), i + 2)));
  const reflection = observedReflections(reference, replacement, bed, peak, dryPeak);
  if (!reflection && Math.max(...eqDb.map(Math.abs), ...motion.map(Math.abs)) < 0.12) {
    return fallback("Converted dialogue already matches the measurable cues.", commonSpeechMs);
  }
  const matched = new Float32Array(count);
  const eq = eqDb.map(gain);
  for (let i = 0; i < count; i++) {
    const frame = i / hop;
    const previous = motion[Math.floor(frame)] || 0;
    const next = motion[Math.ceil(frame)] || 0;
    matched[i] = gain(previous + (next - previous) * (frame % 1)) *
      (dryBands[0][i] * eq[0] + dryBands[1][i] * eq[1] + dryBands[2][i] * eq[2]);
  }
  return {samples: reflection ? addReflections(matched, sampleRate, reflection.decayMs, gain(reflection.wetDb)) : matched, direct: matched, report: {
    version: SCENE_MATCH_VERSION, status: "matched", commonSpeechMs, eqDb: eqDb.map(rounded),
    dynamicsDb: rounded(Math.max(...motion.map(Math.abs))), reflections: reflection,
  }};
}

function addReflections(direct: Float32Array, sampleRate: number, decayMs: number, wet: number) {
  if (!wet) return direct;
  const output = direct.slice();
  const delays = [33, 47, 62, 83, 107, 131];
  const weights = delays.map(delay => Math.exp(-Math.log(1000) * delay / decayMs));
  const scale = wet / Math.hypot(...weights);
  const fade = Math.round(sampleRate * 0.045);
  delays.forEach((delay, index) => {
    const offset = Math.round(sampleRate * delay / 1000);
    const weight = (index % 2 ? -1 : 1) * weights[index] * scale;
    for (let i = offset; i < output.length; i++) {
      output[i] += direct[i - offset] * weight * Math.min(1, (output.length - i - 1) / fade);
    }
  });
  return output;
}

/** Adjust only the converted samples inside this already validated cue. */
export function fineTuneSceneVoice(scene: SceneMatch, tune: SceneFineTune, length: number, sampleRate: number) {
  if (!tune.distance && !tune.reflections) return scene.samples;
  const direct = new Float32Array(length);
  direct.set((scene.direct || scene.samples).subarray(0, length));
  if (tune.distance) {
    const distance = clamp(tune.distance / MAX_SCENE_FINE_TUNE, -1, 1);
    const bands = bandsFor(direct, sampleRate);
    const [low, middle, high] = [0.60, -0.40, -1.65].map(db => gain(db * distance));
    for (let i = 0; i < length; i++) direct[i] = bands[0][i] * low + bands[1][i] * middle + bands[2][i] * high;
  }
  const automatic = scene.report.reflections;
  const wet = automatic ? gain(automatic.wetDb) : 0;
  const blend = clamp(tune.reflections / MAX_SCENE_FINE_TUNE, -1, 1);
  const adjustedWet = blend < 0 ? wet * (1 + blend) : wet + (0.18 - wet) * blend;
  return addReflections(direct, sampleRate, automatic?.decayMs ?? 260, adjustedWet);
}
