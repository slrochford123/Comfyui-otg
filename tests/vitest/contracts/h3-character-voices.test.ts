import { describe, expect, it } from "vitest";
import { compileH3CharacterVoices, type H3CastBinding, type H3CharacterVoicePlan } from "@/lib/h3CharacterVoices";
import { buildH3CharacterVoiceSubmission, nativeH3VoiceWindows, validateH3CharacterVoiceAssembly } from "@/lib/h3CharacterVoicesServer";
import { applyH3CharacterVoiceGraph, assertNativeH3AudioGraph, h3SmartRefModLoaderInputs } from "@/lib/h3SmartReferencesGraph";
import type { H3DirectJobInput } from "@/lib/h3DirectJobs";
import type { H3SmartReferenceMapEntry } from "@/lib/h3SmartReferences";
import { normalizeH3AdvancedSettings } from "@/lib/production/h3Settings";
import type { H3PromptGraph } from "@/lib/production/h3Workflows";

const mode = "h3-reference-to-video" as const;
const people = ["Darius", "Raphael", "Amelia"];
const cast: H3CastBinding[] = people.map((name, index) => ({
  characterId: name.toLowerCase(), name, subject: `<Subject ${index + 1}>`, visual: [`<Picture ${index + 1}>`],
  audio: [`<Audio ${index + 1}>`], voiceId: `voice-${index + 1}`, identity: `${name} wears the approved costume.`,
  ...(name === "Raphael" ? { aliases: ["Rafael"] } : {}),
}));
const references: H3SmartReferenceMapEntry[] = cast.flatMap(member => [
  { tag: member.visual[0], name: member.name, description: "Character Card", source: "image", kind: "image", characterKey: member.characterId },
  { tag: member.audio[0], name: member.name, description: "Saved recording", source: "media", kind: "audio", characterKey: member.characterId, voiceId: member.voiceId },
]);
const compile = (prompt: string, overrides: Partial<Parameters<typeof compileH3CharacterVoices>[0]> = {}) =>
  compileH3CharacterVoices({ prompt, cast, references, mode, durationSeconds: 10, firstImage: false, lastImage: false, ...overrides });

describe("H3 Character Voices prompt compiler", () => {
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

  it.each(permutations.map(order => [order.join(""), order] as const))("keeps voice slots stable for speaking order %s", (_label, order) => {
    const result = compile(order.map((index, turn) => `${turn * 2}–${turn * 2 + 1} ${people[index]}: line ${index}.`).join("\n"));
    expect(result.events.map(event => [event.characterId, event.speakerId, event.wordText])).toEqual(
      order.map((index, turn) => [cast[index].characterId, `S${turn + 1}`, `line ${index}.`]),
    );
    expect(result.bindings.map(binding => [binding.characterId, binding.subject, binding.audio, binding.voiceId])).toEqual(
      cast.map(binding => [binding.characterId, binding.subject, binding.audio, binding.voiceId]),
    );
    expect(result.sharedIdentityPrompt).not.toMatch(/\(S\d+\)/);
    expect(result.sharedIdentityPrompt).toBe(compile(permutations[0].map(index => `${people[index]}: hello.`).join("\n")).sharedIdentityPrompt);
  });

  it("keeps a returning speaker and approved alias bound to the same voice and preserves off-screen delivery", () => {
    const result = compile("Rafael (off-screen): Do you hear me?\nAmelia looks up, then Darius whispers, “Yes.”\nRaphael: Do you hear me?");
    expect(result.events.map(event => [event.characterId, event.speakerId])).toEqual([["raphael", "S1"], ["darius", "S2"], ["raphael", "S1"]]);
    expect(result.events[0].offScreen).toBe(true);
    expect(result.prompt.match(/<d>\[English\] Do you hear me\?<\/d>/g)).toHaveLength(2);
    expect(result.prompt).toContain("<Subject 2> (S1) using <Audio 2>");
    expect(result.prompt).toContain("Amelia looks up, then Darius whispers");
  });

  it("relabels imported assets while retaining authored cuts, visual details, language, intentional continuations and sound", () => {
    const result = compile(`subject_definitions:
<Subject 2> is Darius, whose wool cloak comes from <Picture 9>.
<Subject 3> is Raphael, Amelia's father, clearly defined by <Picture 1>.
<Subject 1> is Amelia from <Picture 4>.
<Audio 3> is timbre for <Subject 2>.
<Audio 2> is timbre for <Subject 3>.
<Audio 1> is timbre for <Subject 1>.

summary:
[reference generation + audio reference] Preserve their exchange.

retention_analysis:
<Subject 2>: partially_preserved — keep the cloak but wet from the rain.
<Audio 3>: reference — a hushed delivery.

detailed_description:
A cool rain splits the lamplight.
[Shot 1] <Subject 3> (S2) says softly: <d>[Spanish] Déjalo <scenetrans></d>
[Shot 2] At 00:03.5, the camera cuts to <Subject 3> (S2) continuing off-screen: <d>[Spanish] <scenetrans>ahí.</d>\n<Subject 2> (S1) whispers: <d>[English] Yes—now.</d>

overall_soundscape:
Light rain and one shoe scrape.

non_diegetic_music:
Very soft piano.`);
    expect(result.events.map(e => [e.characterId, e.speakerId, e.wordText, e.language])).toEqual([
      ["raphael", "S1", "Déjalo ahí.", "Spanish"], ["darius", "S2", "Yes—now.", "English"],
    ]);
    expect(result.prompt).toContain("<Subject 1> is Darius, whose wool cloak comes from <Picture 1>.");
    expect(result.prompt).toContain("<Subject 1>: partially_preserved — keep the cloak but wet from the rain.");
    expect(result.prompt).toContain("<Audio 1>: reference — a hushed delivery.");
    expect(result.prompt).toContain("[Shot 2] At 00:03.500, the camera cuts to");
    expect(result.prompt).toContain("Light rain and one shoe scrape.");
    expect(result.prompt).toContain("Very soft piano.");
    expect(result.prompt).not.toContain("<Picture 9>");
  });

  it("keeps visible text, disallows ambiguous or invented dialogue and validates timing", () => {
    expect(compile('Amelia reads the sign. The sign says “Stay back.”').events).toEqual([]);
    expect(() => compile("Darius says he is ready.")).toThrow(/missing exact dialogue/);
    expect(() => compile('Darius says he is ready. Amelia says “Go.”')).toThrow(/missing exact dialogue/);
    expect(() => compile('Someone says “Go.”')).toThrow(/Who says/);
    expect(() => compile('4–5 Amelia: “Go.”\n1–2 Darius: “Wait.”')).toThrow(/playback order/);
    expect(() => compile('0–11 Amelia: “Go.”')).toThrow(/fit inside/);
  });

  it("rejects stale, duplicated and crossed cast ownership or conflicting imported references", () => {
    expect(() => compile("Darius: Hello.", { references: references.filter(ref => ref.tag !== "<Audio 1>") })).toThrow(/no longer binds/);
    expect(() => compile("Darius: Hello.", { references: references.map(ref => ref.tag === "<Audio 1>" ? { ...ref, characterKey: "amelia" } : ref) })).toThrow(/no longer binds/);
    expect(() => compile("Darius: Hello.", { references: [...references, references[0]] })).toThrow(/unique references/);
    expect(() => compile(`subject_definitions:
<Subject 1> is Amelia with <Picture 1>.
<Subject 2> is Darius with <Picture 1>.
detailed_description:
[Shot 1] Amelia enters.`)).toThrow(/multiple cast members/);
  });

  it("resolves named authoring aliases into the reviewed reference tags", () => {
    const result = compile("@Darius motions to the gate.\n@Rafael: Hold the light.");
    expect(result.prompt).toContain("<Subject 1> motions to the gate.");
    expect(result.events[0].characterId).toBe("raphael");
    expect(result.prompt).toContain("<Subject 2> (S1) using <Audio 2>");
    expect(() => compile("@Unknown steps into the rain.")).toThrow(/not assigned/);
  });
});

describe("Plan A graph and native voice limits", () => {
  function mockGraph(): H3PromptGraph {
    return {
      "39": { class_type: "MiniMaxH3ReferenceToVideo", inputs: { clip: ["4", 0], vae: ["5", 0], audio_vae: ["6", 0], prompt: "prompt", width: 1216, height: 704, length: 243,
        "ref_audios.ref_audio_0": ["a", 0], "ref_audios.ref_audio_1": ["b", 0], "ref_audios.ref_audio_2": ["c", 0] } },
      "4": { class_type: "CLIPLoader", inputs: {} }, "5": { class_type: "VAELoader", inputs: {} }, "6": { class_type: "VAELoader", inputs: {} },
      a: { class_type: "LoadAudio", inputs: { audio: "a.wav" } }, b: { class_type: "LoadAudio", inputs: { audio: "b.wav" } }, c: { class_type: "LoadAudio", inputs: { audio: "c.wav" } },
      "32": { class_type: "BasicGuider", inputs: { conditioning: ["39", 0] } },
    };
  }
  const plan: H3CharacterVoicePlan = { recipe: "visual-refmod-wav", bindings: cast, events: [], references, inputHashes: {}, voiceTargets: [],
    refMods: cast.map(member => ({ id: member.characterId, name: member.name, category: "character", sourceKind: "bundle", strength: 1, copies: 1,
      components: "Visual", visualStrength: 1, audioStrength: 0, description: "identity", characterId: member.characterId })) };

  it("routes all three physically loaded WAVs, visual-only RefMods and audio VAE into the same consumed encoder", () => {
    const graph = mockGraph();
    applyH3CharacterVoiceGraph(graph, plan, mode, ["a.wav", "b.wav", "c.wav"], []);
    expect(graph.character_voice_wavs).toEqual({ class_type: "SLRH3ReferenceMediaBundle", inputs: { audio_0: ["a", 0], audio_1: ["b", 0], audio_2: ["c", 0] } });
    expect(graph["39"]).toMatchObject({ class_type: "PK_MiniMaxH3Combined", inputs: { references: ["character_voice_wavs", 0], mods: ["character_voice_refmods", 0], audio_vae: ["6", 0] } });
    expect(graph["39"].inputs["ref_audios.ref_audio_0"]).toBeUndefined();
    expect(graph["32"].inputs.conditioning).toEqual(["39", 0]);
    expect(graph.character_voice_refmods.inputs.audio_strength_1).toBe(0);
    expect(() => applyH3CharacterVoiceGraph(mockGraph(), plan, mode, ["c.wav", "b.wav", "a.wav"], [])).toThrow(/reviewed reference/);
  });

  it("dry-builds a native sound graph with a combined bundle contributing visuals only", () => {
    const visualCast = cast.map(member => ({...member, audio: []}));
    const visualRefs = references.filter(ref => ref.kind === "image").map(ref => ({...ref, source: "refmod" as const}));
    const compiled = compileH3CharacterVoices({mode, dialogueOnly: true, durationSeconds: 5, firstImage: false,
      lastImage: false, cast: visualCast, references: visualRefs, prompt: "Darius: I see it."});
    const input: H3DirectJobInput = {
      characterVoices: {...plan, recipe: "visual-refmod", nativeAudio: true, bindings: compiled.bindings, events: compiled.events, references: visualRefs},
      mode, targetBackend: "rtx3090", quality: "lq", orientation: "landscape", durationSeconds: 5, seed: 338,
      prompt: compiled.prompt, promptFormat: "minimax-official-v1", preserveExactPrompt: true,
      h3Settings: normalizeH3AdvancedSettings({renderMode: "native"}, 0), optionalLoras: [],
      firstImage: null, lastImage: null, images: [], videos: [], audios: [],
    };
    const graph = buildH3CharacterVoiceSubmission(input, "rtx3090", {first: "", last: "", images: [], audios: [], outputPrefix: "fixture"}).graph;
    expect(graph["39"].class_type).toBe("PK_MiniMaxH3Combined");
    expect(graph.character_voice_refmods.inputs).toMatchObject({components_1: "Visual", audio_strength_1: 0});
    expect(graph["39"].inputs).not.toHaveProperty("references");
    expect(graph["34"].inputs.audio).toEqual(["14", 0]);
  });

  it("keeps prepared WAVs between 2–15 seconds and no more than 15 seconds combined", () => {
    expect(nativeH3VoiceWindows([26, 41, 27])).toEqual([5, 5, 5]);
    expect(nativeH3VoiceWindows([4.221, 2.107, 8.66])).toEqual([4.221, 2.107, 8.66]);
    expect(nativeH3VoiceWindows([2, 20, 20])).toEqual([2, 6.5, 6.5]);
    expect(nativeH3VoiceWindows([43.15])).toEqual([15]);
    expect(() => nativeH3VoiceWindows([1.99])).toThrow(/two seconds/);
    expect(() => nativeH3VoiceWindows([2, 2, 2, 2])).toThrow(/up to three/);
  });

  it("dry-builds the actual 5060 Ti qualified workflow with mixed reference wiring and an independent opening guide", () => {
    const visualCast = cast.map(member => ({ ...member, visual: member.visual.map(tag => tag.replace("Picture", "Video")) }));
    const visualRefs = references.map(ref => ref.kind === "image" ? { ...ref, tag: ref.tag.replace("Picture", "Video"), kind: "video" as const, source: "refmod" as const } : ref);
    const compiled = compileH3CharacterVoices({ mode, durationSeconds: 5, firstImage: true, lastImage: false, cast: visualCast, references: visualRefs,
      prompt: "Amelia: Keep going.\nDarius: I'm here.\nRaphael: One more step." });
    const input: H3DirectJobInput = { characterVoices: { ...plan, bindings: compiled.bindings, events: compiled.events, references: visualRefs },
      targetBackend: "rtx5060ti", mode, quality: "lq", orientation: "landscape", durationSeconds: 5, seed: 338,
      prompt: compiled.prompt, promptFormat: "minimax-official-v1", preserveExactPrompt: true, h3Settings: normalizeH3AdvancedSettings({ renderMode: "native" }, 0),
      optionalLoras: [], firstImage: { path: "/fixture/opening.png", name: "Opening", description: "Approved predecessor frame" }, lastImage: null,
      images: [], videos: [], audios: ["a", "b", "c"].map(name => ({ path: `/fixture/${name}.wav`, name, description: "Saved recording" })) };
    const receipt = validateH3CharacterVoiceAssembly(input, "rtx5060ti");
    expect(receipt.encoder).toBe("PK_MiniMaxH3Combined");
    expect(receipt.wavBundleInputs).toEqual(["audio_0", "audio_1", "audio_2"]);
    expect(receipt.audioVae).toBe(true);
    expect(receipt.openingGuide).toBe(true);
    expect(receipt.referenceMap).toEqual(visualRefs);
    expect(receipt.checkpoint).toBe("minimax_h3_ref2va_pruned_int8_convrot.safetensors");
    const comparison = validateH3CharacterVoiceAssembly({ ...input, h3Settings: normalizeH3AdvancedSettings({ renderMode: "native", checkpointMode: "singularity-v1.3" }, 0) }, "rtx5060ti");
    expect(comparison.checkpoint).toBe("Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors");
  });
});

it("guards native audio at the worker graph, including the component settings for combined RefMods", () => {
  const graph = {
    loader: {class_type: "MiniMaxH3RefModsLoader", inputs: {
      ...h3SmartRefModLoaderInputs([]), mod_1: "cast-bundle", components_1: "Visual", audio_strength_1: 0,
    }},
    decoder: {class_type: "VAEDecodeAudio", inputs: {vae: ["4", 0]}},
    output: {class_type: "CreateVideo", inputs: {audio: ["decoder", 0]}},
  };
  expect(() => assertNativeH3AudioGraph(graph)).not.toThrow();
  expect(() => assertNativeH3AudioGraph({...graph, loader: {...graph.loader, inputs: {...graph.loader.inputs, audio_strength_1: 0.1}}})).toThrow();
  expect(() => assertNativeH3AudioGraph({...graph, source: {class_type: "MiniMaxH3ReferenceToVideo", inputs: {"ref_video_audios.ref_video_audio_0": ["44", 0]}}})).toThrow();
});
