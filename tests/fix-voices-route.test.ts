import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError } from "@/lib/requestError";
import type { VoiceCorrectionAnalysis } from "@/lib/fixVoicesSession";

const mock = vi.hoisted(() => ({
  analysis: vi.fn(), preview: vi.fn(), workPath: vi.fn(), castPlan: vi.fn(), pinnedVoice: vi.fn(), owner: vi.fn(), readable: vi.fn(),
  listVoices: vi.fn(), dub: vi.fn(), extract: vi.fn(), mixer: vi.fn(), acted: vi.fn(), align: vi.fn(), transcript: vi.fn(), check: vi.fn(), mux: vi.fn(),
}));
vi.mock("@/lib/fixVoicesSession", () => ({
  assertFixVoicesTest: vi.fn(), correctionCastPlan: mock.castPlan, correctionMediaUrl: (file: string) => file,
  correctionPath: mock.workPath, readCorrectionRecord: mock.analysis, saveCorrectionPreview: vi.fn(),
  verifiedCorrectionVoice: mock.pinnedVoice, writeCorrectionRecord: mock.preview,
}));
vi.mock("@/lib/productionAudioAccess", async importActual => ({
  ...await importActual<typeof import("@/lib/productionAudioAccess")>(), productionAudioOwner: mock.owner, productionAudioMediaReadable: mock.readable,
}));
vi.mock("@/app/api/voice/models/route", () => ({ GET: mock.listVoices }));
vi.mock("@/app/api/voice/dub/route", () => ({ POST: mock.dub }));
vi.mock("@/lib/fixVoicesAudio", () => ({
  alignActedTake: mock.align, compareObservedSpeech: mock.check, extractCorrectionLine: mock.extract, extractCorrectionSoundtrack: vi.fn(),
  muxCorrectionVideo: mock.mux, openCorrectionMixer: mock.mixer, prepareActedTake: mock.acted, transcribeCorrectionLines: mock.transcript,
}));

import { POST } from "@/app/api/production/audio/dub-preview/route";

let scratch: string;
let analysis: VoiceCorrectionAnalysis;
const ownUrl = "http://localhost:3001/api/production/audio/dub-preview";

function request(voiceMappings: Array<{voiceId: string; targetVoiceId: string; characterId?: string}>, acted = false) {
  const input = JSON.stringify({fixVoices: true, analysisId: "analysis-0001", voiceMappings});
  if (!acted) return new NextRequest(ownUrl, {method: "POST", body: input, headers: {"Content-Type": "application/json"}});
  const form = new FormData();
  form.set("payload", input);
  form.set("take", new File(["recording"], "recording.webm", {type: "audio/webm"}));
  form.set("takeVoiceId", "a");
  form.set("takeSegmentIndex", "0");
  return new NextRequest(ownUrl, {method: "POST", body: form});
}

beforeEach(async () => {
  vi.resetAllMocks();
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "slr-fix-voices-route-"));
  const audio = path.join(scratch, "mock.wav");
  await fs.writeFile(audio, "mocked converter output");
  analysis = {
    sourcePath: "owned-original.mp4", sourceFileName: "original.mp4", durationSeconds: 12, mixReady: true, warnings: [],
    mixSource: {duration: 12, channels: 2, original: "original.wav", speech: "isolated-speech.wav"},
    voices: [
      {id: "a", label: "First", segments: [{start: 0.5, end: 1.5}]},
      {id: "b", label: "Second", segments: [{start: 3, end: 3.7, blockedReason: "overlap"}]},
      {id: "c", label: "Third", segments: [{start: 9, end: 11}]},
    ],
  };
  mock.owner.mockResolvedValue("own-account");
  mock.readable.mockResolvedValue(true);
  mock.analysis.mockResolvedValue(analysis);
  mock.workPath.mockReturnValue(path.join(scratch, "preview"));
  mock.listVoices.mockImplementation(async () => NextResponse.json({items: [
    {id: "library:one", name: "One", engine: "reference", path: "library-one.wav"},
    {id: "character:two:trained", name: "Two", engine: "character", path: "trained.pth", modelPath: "trained.pth", indexPath: "trained.index"},
  ]}));
  mock.extract.mockImplementation(async (_source, _interval, destination) => fs.writeFile(destination, "isolated line"));
  mock.mixer.mockResolvedValue({rejectInterval: () => "", apply: vi.fn().mockResolvedValue(""),
    applySceneMatched: vi.fn().mockResolvedValue({reason:"",sceneMatch:{version:1,status:"standard",reason:"Too little clean speech"}}), write: vi.fn()});
  mock.transcript.mockResolvedValue([[], []]);
  mock.check.mockReturnValue({});
  mock.dub.mockImplementation(async (req: NextRequest) => {
    const form = await req.formData();
    expect(await (form.get("performance_audio") as File).text()).toBe("isolated line");
    expect(form.get("dub_mode")).toBe("preserve_performance");
    expect(form.get("preserve_h3_performance")).toBe("1");
    expect(form.get("engine")).toMatch(/^(applio|seed-vc)$/);
    return NextResponse.json({ok: true, audioPath: audio, engine: form.get("engine"), sourceSpeechMode: "source-performance"});
  });
});
afterEach(async () => fs.rm(scratch, {recursive: true, force: true}));

describe("Fix Voices backend with mocked model calls", () => {
  it("requires a valid confirmation for the isolated cue without unblocking overlap", async () => {
    analysis.cast = [{characterId: "darius", name: "Darius"}];
    analysis.voices[0].needsCharacterConfirmation = true;
    expect((await POST(request([{voiceId: "a", targetVoiceId: "library:one"}]))).status).toBe(422);
    expect(mock.dub).not.toHaveBeenCalled();

    const response = await POST(request([
      {voiceId: "a", targetVoiceId: "library:one", characterId: "darius"},
      {voiceId: "b", targetVoiceId: "library:one", characterId: "darius"},
    ]));
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(mock.dub).toHaveBeenCalledOnce();
    expect(payload.skippedSegments).toEqual([{voiceId: "b", start: 3, end: 3.7, reason: "overlap"}]);
  });

  it("keeps the source cue when converted words cannot be verified", async () => {
    mock.check.mockReturnValueOnce({warning: "Some words could not be checked automatically."});
    const response = await POST(request([{voiceId: "a", targetVoiceId: "library:one"}]));
    expect(response.status).toBe(422);
    expect(mock.mux).not.toHaveBeenCalled();
    expect(mock.preview).not.toHaveBeenCalled();
  });

  it("processes three mappings, skips the overlapped voice and reports the two explicit engines", async () => {
    const result = await POST(request([
      {voiceId: "a", targetVoiceId: "library:one"}, {voiceId: "b", targetVoiceId: "library:one"}, {voiceId: "c", targetVoiceId: "character:two:trained"},
    ]));
    expect(result.status).toBe(200);
    const payload = await result.json();
    expect(payload.renderedSegments.map((entry: {engine: string}) => entry.engine)).toEqual(["seed-vc", "applio"]);
    expect(payload.skippedSegments).toEqual([{voiceId: "b", start: 3, end: 3.7, reason: "overlap"}]);
    expect(mock.extract).toHaveBeenCalledTimes(2);
    expect(mock.extract.mock.calls.every(call => call[0] === "isolated-speech.wav")).toBe(true);
    expect(mock.preview).toHaveBeenCalledWith("own-account", expect.any(String), "preview", expect.objectContaining({renderedSegments: payload.renderedSegments}));
    expect(mock.mux).toHaveBeenCalledWith("owned-original.mp4", expect.any(String), expect.any(String));
  });

  it("isolates an engine failure and keeps a successful unblocked replacement", async () => {
    mock.dub.mockResolvedValueOnce(NextResponse.json({ok: false}, {status: 500}));
    const result = await POST(request([{voiceId: "a", targetVoiceId: "library:one"}, {voiceId: "c", targetVoiceId: "character:two:trained"}]));
    expect(result.status).toBe(200);
    const payload = await result.json();
    expect(payload.renderedSegments.map((entry: {voiceId: string}) => entry.voiceId)).toEqual(["c"]);
    expect(payload.skippedSegments).toEqual([{voiceId: "a", start: 0.5, end: 1.5, reason: expect.stringContaining("original was preserved")}]);
  });

  it("adjusts only selected levels using the stored conversion, including reset from a remix", async () => {
    mock.workPath.mockImplementation((_owner, id) => path.join(scratch, id));
    const records = new Map<string, unknown>();
    mock.preview.mockImplementation((owner, id, _kind, record) => records.set(owner + id, record));
    mock.analysis.mockImplementation((owner, id, kind) => kind === "analysis" ? analysis : records.get(owner + id));
    const first = await POST(request([
      {voiceId: "a", targetVoiceId: "library:one"}, {voiceId: "c", targetVoiceId: "character:two:trained"},
    ]));
    expect(first.status).toBe(200);
    const {previewId} = await first.json();
    function remix(id: string, speakerLevels: Array<{voiceId: string;levelDb: number}>, matchOriginalScene?: unknown, cueAdjustments?: unknown) {
      return POST(new NextRequest(ownUrl, {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({fixVoices: true, action: "remix", previewId: id, speakerLevels, matchOriginalScene, cueAdjustments})}));
    }
    expect((await remix(previewId, [{voiceId: "b", levelDb: -6}])).status).toBe(400);
    expect((await remix(previewId, [], "on")).status).toBe(400);
    expect((await remix(previewId, [], false, [{cueIndex:0,distance:2,reflections:1}])).status).toBe(400);
    expect((await remix(previewId, [], true, [{cueIndex:0,distance:99,reflections:0}])).status).toBe(400);
    const adjustment = await remix(previewId, [{voiceId: "a", levelDb: -6}], true, [{cueIndex:0,distance:2,reflections:1}]);
    expect(adjustment.status).toBe(200);
    const changed = await adjustment.json();
    expect(changed.renderedSegments.map((segment: {levelDb: number}) => segment.levelDb)).toEqual([-6, 0]);
    expect(changed.matchOriginalScene).toBe(true);
    expect(changed.renderedSegments[0].sceneMatch.status).toBe("standard");
    expect(changed.renderedSegments[0].fineTune).toEqual({distance:2,reflections:1});
    expect(changed.renderedSegments[1].fineTune).toBeUndefined();
    expect(changed.unadjustedVideoUrl).toContain(previewId);
    expect(mock.preview).toHaveBeenLastCalledWith("own-account",changed.previewId,"preview",expect.objectContaining({renderedSegments:changed.renderedSegments}));
    expect((await mock.mixer.mock.results.at(-1)?.value).applySceneMatched).toHaveBeenCalledWith(expect.objectContaining({voiceId:"a",levelDb:-6}));
    const reset = await remix(changed.previewId, []);
    expect(reset.status).toBe(200);
    const restored = await reset.json();
    expect(restored.renderedSegments.map((segment: {levelDb: number}) => segment.levelDb)).toEqual([0, 0]);
    expect(restored.matchOriginalScene).toBe(false);
    expect(restored.renderedSegments[0].sceneMatch).toBeUndefined();
    expect(restored.renderedSegments[0].fineTune).toBeUndefined();
    expect(mock.dub).toHaveBeenCalledTimes(2);
    expect(mock.transcript).toHaveBeenCalledTimes(2);
    const mixer = await mock.mixer.mock.results.at(-1)?.value;
    expect(mixer.apply).toHaveBeenLastCalledWith(expect.objectContaining({levelDb: 0, audioPath: expect.stringContaining(previewId)}));
  });

  it("refuses an all-overlap result without a conversion, mux or saved preview", async () => {
    const result = await POST(request([{voiceId: "b", targetVoiceId: "library:one"}]));
    expect(result.status).toBe(422);
    expect(mock.dub).not.toHaveBeenCalled();
    expect(mock.mux).not.toHaveBeenCalled();
    expect(mock.preview).not.toHaveBeenCalled();
  });

  it("keeps the original when decoded speech verification fails", async () => {
    mock.transcript.mockRejectedValue(new Error("Decoder failure"));
    const result = await POST(request([{voiceId: "a", targetVoiceId: "library:one"}]));
    expect(result.status).toBe(422);
    expect((await result.json()).error).toMatch(/Speech verification failed/);
    expect((await mock.mixer.mock.results[0].value).apply).not.toHaveBeenCalled();
    expect(mock.mux).not.toHaveBeenCalled();
    expect(mock.preview).not.toHaveBeenCalled();
  });

  it("refuses a stale H3 suggestion in place of a changed saved voice ID", async () => {
    analysis.sourceJobId = "h3-direct-023ff360-c209-4f19-a9a0-e59005ba0c52";
    analysis.voices[0].suggestedTargetVoiceId = "library:one";
    analysis.voices[0].suggestedCharacterId = "character-a";
    mock.castPlan.mockResolvedValue({voiceTargets: [{characterId: "character-a", modelId: "library:one", sample: {path: "original-voice.wav"}}]});
    mock.pinnedVoice.mockResolvedValue(null);
    const result = await POST(request([{voiceId: "a", targetVoiceId: "library:one"}]));
    expect(result.status).toBe(422);
    expect((await result.json()).error).toMatch(/changed/);
    expect(mock.pinnedVoice).toHaveBeenCalledOnce();
    expect(mock.dub).not.toHaveBeenCalled();
  });

  it("leaves the original when an acted take cannot match its line", async () => {
    mock.acted.mockResolvedValue("candidate-take.wav");
    mock.align.mockRejectedValue(new RequestError("This take is too far from the mouth timing. Replay the cue and record again.", 422));
    const result = await POST(request([{voiceId: "a", targetVoiceId: "library:one"}], true));
    expect(result.status).toBe(422);
    expect((await result.json()).error).toMatch(/mouth timing/);
    expect(mock.dub).not.toHaveBeenCalled();
    expect(mock.preview).not.toHaveBeenCalled();
  });
});
