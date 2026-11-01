import { describe, expect, it } from "vitest";
import { appendH3SmartMediaMap, checkH3SmartReferences, compileH3SmartReferencePrompt, normalizeH3SmartReferenceSelection, type H3SmartReferenceCapabilities, type H3SmartReferenceInput } from "@/lib/h3SmartReferences";
import { normalizeH3RefModSlots } from "@/lib/h3SpecialModes/refMods";
import { buildH3RefModsT2VWorkflow } from "@/lib/h3SpecialModes/refModsWorkflow";
import { buildH3RealismWorkflow } from "@/lib/h3SpecialModes/realismWorkflow";
import { DEFAULT_H3_ADVANCED_SETTINGS, type H3CheckpointMode } from "@/lib/production/h3Settings";
import { buildH3Workflow } from "@/lib/production/h3Workflows";
import { applyH3SmartReferenceGraph } from "@/lib/h3SmartReferencesGraph";
const slots = normalizeH3RefModSlots([{name: "characters/cat", sourceKind: "image", category: "character", strength: 1}]);
const image = {path: "/owned/girl.png", name: "Little Girl", description: "the girl’s appearance"};
const frame = {path: "/owned/frame.png", name: "Opening composition", description: ""};
const cap: H3SmartReferenceCapabilities = {backend: "rtx3090", available: true, firstFrame: true, mixedReferences: true, reason: "", maxImages: 9, maxVideos: 3, maxAudios: 3, maxTotalReferenceMedia: 12, maxRefModSlots: 8, firstFrameConsumesReferenceAllowance: false, referenceTokenBudget: null, tokenBudgetExplanation: "No fixed budget", refMods: [{name: slots[0].name, kind: "image", tokens: 100}]};
function smart(images = [image], useFirstFrame = true): H3SmartReferenceInput {
 const selection = {useFirstFrame, refMods: slots};
 return {...selection, images, firstFrame: useFirstFrame ? frame : null, referenceMap: checkH3SmartReferences(cap, selection, images, 0, 0, useFirstFrame).referenceMap};
}
function build(backend: "rtx3090" | "rtx5060ti", checkpointMode: H3CheckpointMode, renderMode: "native" | "turbo", input?: H3SmartReferenceInput) {
 return buildH3RefModsT2VWorkflow({backend, h3Settings: {...DEFAULT_H3_ADVANCED_SETTINGS, checkpointMode, renderMode}, quality: "sh", orientation: "landscape", durationSeconds: 5, prompt: input ? compileH3SmartReferencePrompt('The girl lifts the cat. She says "Hello".', input) : "The cat walks.", refMods: slots, turbo: renderMode === "turbo", seed: 42, outputPrefix: "qa/smart", smartReferences: input, smartFirstFrameFilename: input?.useFirstFrame ? "opening.png" : undefined, smartImageFilenames: input?.images.map(() => "girl.png")});
}
function assertLinks(graph: ReturnType<typeof build>["graph"]) {
 for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number") expect(graph[value[0]], `missing ${value[0]}`).toBeDefined();
}
describe("Smart References count and numbering contracts", () => {
 it("numbers ordinary images then actual expanded saved RefMod members, with the opening frame separate", () => {
  const result = checkH3SmartReferences(cap, {useFirstFrame: true, refMods: [{...slots[0], copies: 2}]}, [image], 0, 0, true);
  expect(result.counts).toEqual({image: 3, video: 0, audio: 0}); expect(result.refModTokens).toBe(200);
  expect(result.referenceMap.map(item => [item.tag, item.name])).toEqual([["<Picture 1>", "Little Girl"], ["<Picture 2>", "characters/cat"], ["<Picture 3>", "characters/cat"]]);
 });
 it("does not claim eight plus nine separate image allowances", () => {
  expect(() => checkH3SmartReferences(cap, {useFirstFrame: false, refMods: slots}, Array.from({length: 9}, () => image))).toThrow("9-reference envelope");
  expect(() => checkH3SmartReferences(cap, {useFirstFrame: false, refMods: [{...slots[0], copies: 10}]}, [])).toThrow("reduce RefMod copies");
 });
 it("counts total media independently of per-type limits", () => {
  expect(() => checkH3SmartReferences(cap, {useFirstFrame: false, refMods: []}, Array.from({length: 9}, () => image), 3, 1)).toThrow("12 reference media");
 });
 it("gates the actual missing combined encoder without switching GPU/model", () => {
  expect(() => checkH3SmartReferences({...cap, backend: "rtx5060ti", mixedReferences: false, reason: "Combined encoder not installed"}, {useFirstFrame: false, refMods: slots}, [image])).toThrow("not installed");
  expect(() => checkH3SmartReferences({...cap, backend: "rtx5060ti", mixedReferences: false}, {useFirstFrame: true, refMods: slots}, [], 0, 0, true)).not.toThrow();
 });
 it("rejects unsupported first-frame, missing image, unavailable RefMod and unverified bundles", () => {
  expect(() => checkH3SmartReferences({...cap, firstFrame: false}, {useFirstFrame: true, refMods: []}, [image], 0, 0, true)).toThrow("timeline-guide");
  expect(() => checkH3SmartReferences(cap, {useFirstFrame: true, refMods: []}, [image])).toThrow("Choose the opening image");
  expect(() => checkH3SmartReferences({...cap, refMods: []}, {useFirstFrame: false, refMods: slots}, [])).toThrow("not available on this GPU");
  expect(() => checkH3SmartReferences({...cap, refMods: [{name: slots[0].name, kind: "bundle"}]}, {useFirstFrame: false, refMods: slots}, [image])).toThrow("unverified bundle");
 });
 it("leaves existing multi-video/audio capability intact and rejects mixed media rather than dropping tracks", () => {
  expect(checkH3SmartReferences(cap, {useFirstFrame: true, refMods: []}, [image], 3, 3, true).counts).toEqual({image: 1, video: 3, audio: 3});
  expect(() => checkH3SmartReferences(cap, {useFirstFrame: false, refMods: slots}, [image], 1, 0)).toThrow("does not replace the video/audio path");
 });
 it("skips disabled components and zero strength exactly as the loader does", () => {
  expect(checkH3SmartReferences(cap, {useFirstFrame: false, refMods: [{...slots[0], strength: 0, copies: 10}]}, [image]).counts.image).toBe(1);
  expect(checkH3SmartReferences(cap, {useFirstFrame: false, refMods: [{...slots[0], components: "Audio"}]}, [image]).counts.image).toBe(1);
 });
 it("preserves the original prompt, dialogue and automatic instruction exactly once", () => {
  const raw = '  A girl lifts the cat.\nShe says "Hello, cat!".  ';
  const compiled = compileH3SmartReferencePrompt(raw, smart());
  expect(compiled).toContain(raw); expect(compiled.split('"Hello, cat!"')).toHaveLength(2);
  expect(compiled).toContain("<Subject 1> uses <Picture 1>"); expect(compiled).toContain("<Subject 2> uses <Picture 2>");
  expect(compileH3SmartReferencePrompt(compiled, smart())).toBe(compiled);
 });
 it("does not accept arbitrary asset paths from a smart-selection request", () => {
  expect(normalizeH3SmartReferenceSelection({useFirstFrame: false, refMods: [], firstFrame: {path: "/etc/passwd"}})).toEqual({useFirstFrame: false, refMods: []});
  expect(() => normalizeH3SmartReferenceSelection({useFirstFrame: "yes"})).toThrow();
 });
});
describe("Smart References native conditioning graph", () => {
 for (const backend of ["rtx3090", "rtx5060ti"] as const) for (const checkpoint of ["standard", "singularity", "singularity-v1.3", "fasth3", "selflift"] as H3CheckpointMode[]) {
  it.each(["native", "turbo"] as const)(`${backend} ${checkpoint} %s adds one genuine frame-zero guide and preserves the qualified model chain`, renderMode => {
   const old = build(backend, checkpoint, renderMode), next = build(backend, checkpoint, renderMode, smart([]));
   for (const id of ["30", "18", "24", "38"]) expect(next.graph[id]).toEqual(old.graph[id]);
   expect(next.graph["9400"].inputs.mod_1).toBe(slots[0].name);
   expect(next.graph.smart_frame_zero).toMatchObject({class_type: "MiniMaxH3AddGuide", inputs: {positive: ["9401", 0], latent: ["39", 1], frame_idx: 0, image: ["smart_first_frame", 0]}});
   expect(Object.values(next.graph).filter(node => node.class_type === "MiniMaxH3AddGuide")).toHaveLength(1);
   expect(next.graph["32"].inputs.conditioning).toEqual(["smart_frame_zero", 0]);
   if (checkpoint === "selflift") expect(next.graph["21"].inputs.positive).toEqual(["smart_frame_zero", 0]);
   assertLinks(next.graph);
  });
 }
 it.each([false, true])("combines images and saved conditioning once (first frame %s)", useFirst => {
  const result = build("rtx3090", "standard", "native", smart([image], useFirst));
  expect(result.graph["39"].class_type).toBe("PK_MiniMaxH3Combined");
  expect(result.graph["39"].inputs).toMatchObject({mods: ["9400", 0], "reference_images.reference_image_0": ["smart_reference_image_0", 0], vlm_resolution: 0});
  expect(result.graph["39"].inputs.first_frame).toBeUndefined(); expect(result.graph["9401"]).toBeUndefined();
  expect(Object.values(result.graph).filter(n => n.class_type === "MiniMaxH3RefModApply")).toHaveLength(0);
  expect(result.graph["21"].inputs.latent_image).toEqual(["39", 1]); assertLinks(result.graph);
 });
 it("allows ordinary images alone in RefMods without converting or saving them as RefMods", () => {
  const input = {...smart(), refMods: [], referenceMap: [{tag: "<Picture 1>", name: image.name, source: "image" as const, kind: "image" as const, description: ""}]};
  const result = build("rtx3090", "standard", "native", input);
  expect(result.graph["9400"]).toBeUndefined(); expect(result.graph["9401"]).toBeUndefined();
  expect(result.graph["39"].class_type).toBe("MiniMaxH3ReferenceToVideo");
  expect(Object.values(result.graph).some(n => /RefModExtract|RefModSave/.test(n.class_type))).toBe(false);
  assertLinks(result.graph);
 });
 it("leaves the original graph unchanged when Smart References is absent", () => {
  const graph = build("rtx3090", "standard", "native").graph, snapshot = structuredClone(graph);
  applyH3SmartReferenceGraph(graph, undefined, {conditioningNodeId: "39"}); expect(graph).toEqual(snapshot);
 });
 it("preserves the Realism checkpoint, speed, optional model chain and output path", () => {
  const args = {prompt: "A girl lifts a cat.", quality: "sh" as const, orientation: "landscape" as const, durationSeconds: 5 as const, seed: 42, outputPrefix: "qa/smart", references: [{kind: "image" as const, name: image.name, description: "", uploadedFilename: "girl.png"}]};
  const old = buildH3RealismWorkflow(args), next = buildH3RealismWorkflow({...args, smartReferences: smart(), smartFirstFrameFilename: "opening.png"});
  for (const id of ["192", "53", "261", "264", "337"]) expect(next.graph[id]).toEqual(old.graph[id]);
  expect(next.graph["265"].class_type).toBe("PK_MiniMaxH3Combined"); expect(next.graph.smart_frame_zero.inputs?.frame_idx).toBe(0);
 });
});

describe("ordinary Reference workflow smart integration", () => {
 it.each(["standard", "singularity", "singularity-v1.3", "fasth3", "selflift"] as H3CheckpointMode[])("compiles RefMod-only / frame-zero requests through the existing %s builder", checkpointMode => {
  const input = smart([]);
  const built = buildH3Workflow({backend: "rtx3090", mode: "h3-reference-to-video", h3Quality: "sh", orientation: "landscape", durationSeconds: 5, finalPrompt: compileH3SmartReferencePrompt("The cat walks.", input), seed: 42, outputPrefix: "qa/smart", references: [], voices: [], smartReferenceMap: input.referenceMap, h3Settings: {...DEFAULT_H3_ADVANCED_SETTINGS, checkpointMode}});
  applyH3SmartReferenceGraph(built.graph, input, {conditioningNodeId: "39", firstFrameFilename: "opening.png", imageFilenames: []});
  expect(built.graph["32"].inputs.conditioning).toEqual(["smart_frame_zero", 0]);
  expect(Object.values(built.graph).filter(node => node.class_type === "MiniMaxH3AddGuide")).toHaveLength(1);
 });
 it("allows the resolved mixed map without weakening the legacy manifest guard", () => {
  const input = smart();const args = {backend: "rtx3090" as const, mode: "h3-reference-to-video" as const, h3Quality: "sh" as const, orientation: "landscape" as const, durationSeconds: 5 as const, finalPrompt: compileH3SmartReferencePrompt("The girl lifts the cat.", input), seed: 42, outputPrefix: "qa/smart", references: [{id: "girl", sourceKind: "production-upload" as const, sourceId: "girl", name: "Little Girl", workflowImage: "/owned/girl.png", generationSourceType: "production-upload" as const, pictureSlot: 1 as const, subjectSlot: 1 as const, uploadedFilename: "girl.png"}], voices: []};
  expect(() => buildH3Workflow(args)).toThrow();
  const result = buildH3Workflow({...args, smartReferenceMap: input.referenceMap});
  applyH3SmartReferenceGraph(result.graph, input, {conditioningNodeId: "39", firstFrameFilename: "opening.png", imageFilenames: ["girl.png"]});
  expect(result.graph["39"].class_type).toBe("PK_MiniMaxH3Combined");
  expect(() => buildH3Workflow({...args, smartReferenceMap: input.referenceMap, finalPrompt: args.finalPrompt + " <Picture 99>"})).toThrow("outside the resolved");
 });
 it("numbers a video soundtrack ahead of standalone audio without counting it as an extra media file", () => {
  const map = appendH3SmartMediaMap([], [{name: "walk.mp4", includeAudio: true}, {name: "silent.mp4"}], [{name: "music.wav"}]);
  expect(map.map(item => [item.tag, item.name])).toEqual([["<Audio 1>", "walk.mp4 soundtrack"], ["<Video 1>", "walk.mp4"], ["<Video 2>", "silent.mp4"], ["<Audio 2>", "music.wav"]]);
 });
});
