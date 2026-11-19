import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { labelBlockedVoiceIntervals, replaceDialoguePcm, validateSpeechActivity, type VoiceLane } from "@/lib/fixVoicesDsp";
import { compareObservedSpeech, extractCorrectionSoundtrack, inspectCorrectionClip, muxCorrectionVideo, openCorrectionMixer } from "@/lib/fixVoicesAudio";
import { fineTuneSceneVoice, matchVoiceScene } from "@/lib/fixVoicesSceneMatch";

const run = promisify(execFile);

describe("Fix Voices soundtrack safety", () => {
  it("keeps the standard conversion when the acoustic reference is too short or masked by effects", () => {
    const short = new Float32Array(4800);
    expect(matchVoiceScene(short,short,1,short,48000).samples).toBe(short);
    const voice = Float32Array.from({length:48000},(_,i)=>.1 * Math.sin(i*.06));
    const masked = Float32Array.from(voice,(sample,i)=>sample + .08 * Math.sin(i*.17));
    expect(matchVoiceScene(voice,masked,1,voice,48000).samples).toBe(voice);
  });

  it("uses repeated clean speech decays for quiet reflections and keeps dry speech free of added reflections", () => {
    const sampleRate = 16000;
    const dry = new Float32Array(sampleRate * 3);
    const reflected = dry.slice();
    for (const [start, amplitude] of [[.20,.10],[1.10,.18],[2,.12]]) {
      for (let i=0;i<.38*sampleRate;i++) {
        const t=i/sampleRate;
        const tone=amplitude * Math.sin(2*Math.PI*230*t);
        dry[Math.round(start*sampleRate)+i]=tone;
        reflected[Math.round(start*sampleRate)+i]=tone * (.85+.3*t/.38);
      }
      for (let i=0;i<.3*sampleRate;i++) {
        const t=i/sampleRate;
        reflected[Math.round((start+.38)*sampleRate)+i]=amplitude*.32 * 10**(-3*t/.30) * Math.sin(2*Math.PI*290*t);
      }
    }
    expect(matchVoiceScene(dry,dry,1,dry,sampleRate).report.reflections).toBeUndefined();
    const match = matchVoiceScene(reflected,reflected,1,dry,sampleRate);
    expect(match.report.status).toBe("matched");
    expect(match.report.reflections?.observations).toBe(3);
    expect(match.report.reflections?.wetDb).toBeLessThanOrEqual(-17);
    expect(match.samples.length).toBe(dry.length);
    expect(match.samples.subarray(0,Math.round(.20*sampleRate)).every(sample=>sample===0)).toBe(true);
    expect(fineTuneSceneVoice(match,{distance:0,reflections:0},dry.length,sampleRate)).toBe(match.samples);
    expect(fineTuneSceneVoice(match,{distance:0,reflections:-3},dry.length,sampleRate)).toEqual(match.direct);
    const farther = fineTuneSceneVoice(match,{distance:3,reflections:2},dry.length,sampleRate);
    expect(farther).toHaveLength(dry.length);
    expect(farther).not.toEqual(match.samples);
    expect(farther.subarray(0,Math.round(.20*sampleRate)).every(sample=>sample===0)).toBe(true);
  });
  it("keeps overlapping speakers and estimated turns locked", () => {
    const lanes: VoiceLane[] = [
      {id: "one", segments: [{start: 0, end: 0.7}, {start: 2, end: 2.5}]},
      {id: "two", segments: [{start: 0.4, end: 1.5}]},
    ];
    expect(labelBlockedVoiceIntervals(lanes, true)).toBe(true);
    expect(lanes[0].segments[0].blockedReason).toMatch(/overlaps/);
    expect(lanes[1].segments[0].blockedReason).toMatch(/overlaps/);
    expect(lanes[0].segments[1].blockedReason).toBeUndefined();
    labelBlockedVoiceIntervals(lanes, false);
    expect(lanes[0].segments[1].blockedReason).toMatch(/uncertain/);
  });

  it("edits just the selected sample window and retains its stereo balance", () => {
    const speech = Float32Array.from({length: 80}, (_, index) => index % 2 ? 0.1 : 0.2);
    const original = Float32Array.from(speech, sample => sample + 0.12);
    const output = original.slice();
    const alternate = Float32Array.from({length: 20}, (_, index) => index % 2 ? -0.2 : 0.2);
    expect(replaceDialoguePcm(original, speech, alternate, output, 10, 30, 2, 1000)).toBe("");
    expect(output.slice(0, 20)).toEqual(original.slice(0, 20));
    expect(output.slice(60)).toEqual(original.slice(60));
    expect(output.length).toBe(original.length);
    expect(output[42]).toBeCloseTo(-0.08);
    expect(output[43]).toBeCloseTo(0.02);
  });

  it("leaves the original byte-for-byte when a replacement would clip or overrun", () => {
    const speech = new Float32Array(20).fill(0.2);
    const original = new Float32Array(20).fill(0.96);
    const output = original.slice();
    const clipping = Float32Array.from({length: 12}, (_, index) => index === 6 ? 0.5 : 0.1);
    expect(replaceDialoguePcm(original, speech, clipping, output, 4, 16, 1, 1000)).toMatch(/clip/);
    expect(replaceDialoguePcm(original, speech, new Float32Array(24).fill(0.2), output, 4, 16, 1, 1000)).toMatch(/runs past/);
    expect(output).toEqual(original);
  });

  it("turns down only the converted dialogue and retains the original background", () => {
    const speech = Float32Array.from({length: 160}, (_, i) => i % 2 ? 0.1 : 0.2);
    const original = Float32Array.from(speech, (sample, i) => sample + (i % 2 ? 0.05 : 0.12));
    const output = original.slice();
    const replacement = new Float32Array(40).fill(-0.2);
    expect(replaceDialoguePcm(original, speech, replacement, output, 20, 60, 2, 1000, -6)).toBe("");
    expect(output[80]).toBeCloseTo(0.12 - 0.2 * 10 ** (-6 / 20), 6);
    expect(output[81]).toBeCloseTo(0.05 - 0.1 * 10 ** (-6 / 20), 6);
    expect(output.slice(0, 40)).toEqual(original.slice(0, 40));
    expect(output.slice(120)).toEqual(original.slice(120));
  });

  it.each([4, 12])("preserves the complete %s-second soundtrack with simultaneous effects and unselected voices", (duration) => {
    const sampleRate = 1000;
    const sampleCount = duration * sampleRate;
    const effects = Float32Array.from({length: sampleCount}, (_, sample) => sample === 1550 ? 0.2 : 0);
    const music = Float32Array.from({length: sampleCount}, (_, sample) => Math.sin(sample / 7) * 0.03);
    const target = Float32Array.from({length: 1000}, (_, sample) => Math.sin(sample / 5) * 0.15);
    const speech = new Float32Array(sampleCount);
    speech.set(target, 1000);
    speech.fill(0.08, 2500, 2800);
    if (duration === 12) speech.fill(0.06, 8700, 9200);
    const mixed = Float32Array.from(speech, (sample, index) => sample + effects[index] + music[index]);
    const output = mixed.slice();
    const replacement = Float32Array.from(target, sample => -sample);
    expect(replaceDialoguePcm(mixed, speech, replacement, output, 1000, 2000, 1, sampleRate)).toBe("");
    expect(output).toHaveLength(sampleCount);
    expect(output.slice(0, 1000)).toEqual(mixed.slice(0, 1000));
    expect(output.slice(2000)).toEqual(mixed.slice(2000));
    expect(output[1550] - replacement[550]).toBeCloseTo(effects[1550] + music[1550], 6);
  });

  it("rejects a line that starts too late or ends early", () => {
    const source = Float32Array.from({length: 1000}, (_, index) => index < 100 || index > 900 ? 0 : 0.1);
    const late = Float32Array.from({length: 1000}, (_, index) => index < 260 || index > 900 ? 0 : 0.1);
    const earlyEnd = Float32Array.from({length: 1000}, (_, index) => index < 100 || index > 740 ? 0 : 0.1);
    expect(validateSpeechActivity(source, source, 1, 1000)).toBe("");
    expect(validateSpeechActivity(source, late, 1, 1000)).toMatch(/ends too far/);
    expect(validateSpeechActivity(source, earlyEnd, 1, 1000)).toMatch(/ends too far/);
  });

  it("flags changed words and timing when confidence allows an automatic check", () => {
    const held = [{text: "Hold.", start: 0.06, end: 0.36, probability: 0.98}];
    expect(compareObservedSpeech(held, [{...held[0], text: "hold"}])).toEqual({});
    expect(compareObservedSpeech(held, [{...held[0], text: "Go"}]).reason).toMatch(/changed/);
    expect(compareObservedSpeech(held, [{...held[0], end: 0.5}]).reason).toMatch(/timing/);
    expect(compareObservedSpeech(held, [{...held[0], probability: 0.5}]).warning).toMatch(/Compare/);
  });

  const fixtureRoot = process.env.SLR_FIX_VOICES_TEST_FIXTURES;
  it.skipIf(!fixtureRoot).each([[4, "04s-single"], [12, "12s-three-speakers"]] as const)(
    "checks the physical %s-second audio fixture with isolated dialogue and untouched samples", async (duration, name) => {
      const fixture = path.join(fixtureRoot!, name);
      const work = await fs.mkdtemp(path.join(os.tmpdir(), "slr-fix-voices-mix-"));
      try {
        const soundtrack = path.join(fixture, "original-mix.wav");
        const monoSpeech = path.join(fixture, "dialogue.wav");
        const speech = path.join(work, "fixture-dialogue-stereo.wav");
        // The recorded fixture puts its mono dialogue at unity in both speakers.
        await run("ffmpeg", ["-v", "error", "-i", monoSpeech, "-af", "pan=stereo|FL=c0|FR=c0", "-c:a", "pcm_f32le", speech]);
        const truth = JSON.parse(await fs.readFile(path.join(fixture, "truth.json"), "utf8"));
        const {channels, duration: probed} = await inspectCorrectionClip(path.join(fixture, "original.mp4"), true);
        expect(probed).toBe(duration);
        const {start_sample: startFrame, end_sample: endFrame} = truth.speech_cues[0];
        const start = startFrame / 48000;
        const end = endFrame / 48000;
        const mixer = await openCorrectionMixer({duration, channels, original: soundtrack, speech,
          effects: path.join(fixture, "effects.wav"), music: path.join(fixture, "music.wav")});
        expect(mixer.rejectInterval({start, end})).toBe("");
        const replacement = path.join(work, "test-polarity-change.wav");
        // Deterministic stand-in for converter output with the original timing.
        await run("ffmpeg", ["-v", "error", "-i", monoSpeech, "-ss", String(start), "-t", String(end - start), "-ac", "1", "-af", "volume=-1", "-c:a", "pcm_f32le", replacement]);
        expect(await mixer.apply({start, end, audioPath: replacement})).toBe("");
        const corrected = path.join(work, "test-correction.wav");
        await mixer.write(corrected);
        const samples = async (file: string) => (await run("ffmpeg", ["-v", "error", "-i", file, "-ac", String(channels), "-ar", "48000", "-f", "f32le", "pipe:1"], {encoding: "buffer", maxBuffer: 8_000_000})).stdout;
        const [actual, original] = await Promise.all([samples(corrected), samples(soundtrack)]);
        expect(actual.byteLength).toBe(duration * 48000 * channels * 4);
        expect(actual.subarray(0, startFrame * channels * 4).equals(original.subarray(0, startFrame * channels * 4))).toBe(true);
        expect(actual.subarray(endFrame * channels * 4).equals(original.subarray(endFrame * channels * 4))).toBe(true);
        expect(actual.equals(original)).toBe(false);
      } finally { await fs.rm(work, {recursive: true, force: true}); }
    },
  );

  it("stream-copies the picture while keeping the verified clip duration", async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "slr-fix-voices-"));
    try {
      const source = path.join(work, "source.mp4");
      await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=size=32x32:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "4", "-c:v", "libx264", "-c:a", "aac", source]);
      const audio = await extractCorrectionSoundtrack(source, work, true);
      expect(audio.duration).toBe(4);
      const output = path.join(work, "correction.mp4");
      await muxCorrectionVideo(source, audio.original, output);
      expect((await inspectCorrectionClip(output, true)).duration).toBe(4);
    } finally { await fs.rm(work, {recursive: true, force: true}); }
  });
});
