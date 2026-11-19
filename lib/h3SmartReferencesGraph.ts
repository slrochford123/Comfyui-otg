import type { H3PromptGraph } from "@/lib/production/h3Workflows";
import type { H3RefModSlot } from "@/lib/h3SpecialModes/refMods";
import type { H3SmartReferenceInput } from "@/lib/h3SmartReferences";
import type { H3CharacterVoicePlan } from "@/lib/h3CharacterVoices";
import { H3_WORKFLOW_CONTRACTS, type ProductionV2H3Mode } from "@/lib/production/h3Workflows";
export function h3SmartRefModLoaderInputs(slots: H3RefModSlot[]) {
  const inputs: Record<string, unknown> = {show_info: false, max_total_tokens: 0};
  for (let i = 0; i < 8; i++) {
    const s = slots[i], n = i + 1;
    Object.assign(inputs, {[`mod_${n}`]: s?.name || "(none)", [`strength_${n}`]: s?.strength ?? 1, [`copies_${n}`]: s?.copies ?? 1,
      [`components_${n}`]: s?.components === "Auto" ? "All" : s?.components || "All", [`visual_strength_${n}`]: s?.visualStrength ?? 1, [`audio_strength_${n}`]: s?.audioStrength ?? 1});
  }
  return inputs;
}
function replaceConditioning(graph: H3PromptGraph, from: string, to: string, skip: string[] = []) {
  for (const [id, node] of Object.entries(graph)) {
    if (skip.includes(id)) continue;
    for (const [key, value] of Object.entries(node.inputs)) if (Array.isArray(value) && value.length === 2 && value[0] === from && value[1] === 0) node.inputs[key] = [to, 0];
  }
}
/** Changes conditioning only; the qualified checkpoint, samplers, LoRAs and AV latent remain bound. */
export function applyH3SmartReferenceGraph(graph: H3PromptGraph, smart: H3SmartReferenceInput | undefined, options: {
  conditioningNodeId: string; firstFrameFilename?: string; imageFilenames?: string[]; existingRefModEncoderId?: string;
}) {
  if (!smart) return;
  const id = options.conditioningNodeId, cond = graph[id];
  if (!cond || cond.class_type !== "MiniMaxH3ReferenceToVideo") throw Error("Smart References requires the native H3 reference conditioning path.");
  const inputs = {...cond.inputs};
  let positiveId = options.existingRefModEncoderId || id;
  if (!smart.refMods.length && options.existingRefModEncoderId) {
    replaceConditioning(graph, options.existingRefModEncoderId, id);
    delete graph[options.existingRefModEncoderId]; delete graph["9400"];
    positiveId = id;
    const filenames = options.imageFilenames || [];
    if (filenames.length !== smart.images.length) throw Error("The image reference upload map is incomplete.");
    filenames.forEach((filename, n) => {
      const imageId = `smart_reference_image_${n}`;
      graph[imageId] = {class_type: "LoadImage", inputs: {image: filename}};
      cond.inputs[`ref_images.ref_image_${n}`] = [imageId, 0];
    });
  }
  if (smart.refMods.length) {
    if (graph.smart_refmod_loader || graph.smart_refmod_encode) throw Error("Smart reference graph node collision.");
    // Reuse the existing RefMods loader; never attach the same bundle twice.
    const loaderId = graph["9400"]?.class_type === "MiniMaxH3RefModsLoader" ? "9400" : "smart_refmod_loader";
    graph[loaderId] = {class_type: "MiniMaxH3RefModsLoader", inputs: h3SmartRefModLoaderInputs(smart.refMods)};
    if (smart.images.length) {
      const combined: Record<string, unknown> = {};
      for (const key of ["clip", "vae", "audio_vae", "prompt", "width", "height", "length", "ref_image_size"]) if (inputs[key] !== undefined) combined[key] = inputs[key];
      Object.assign(combined, {ref_image_size: inputs.ref_image_size || "match", vlm_resolution: 0, vlm_video_resolution: 0, reference_fps: 24, max_total_tokens: 0, mods: [loaderId, 0]});
      const filenames = options.imageFilenames || [];
      if (filenames.length !== smart.images.length) throw Error("The mixed reference upload map is incomplete.");
      filenames.forEach((filename, n) => {
        const imageId = `smart_reference_image_${n}`;
        if (graph[imageId]) throw Error("Smart reference image node collision.");
        graph[imageId] = {class_type: "LoadImage", inputs: {image: filename}};
        combined[`reference_images.reference_image_${n}`] = [imageId, 0];
      });
      cond.class_type = "PK_MiniMaxH3Combined"; cond.inputs = combined;
      if (options.existingRefModEncoderId) {
        replaceConditioning(graph, options.existingRefModEncoderId, id);
        delete graph[options.existingRefModEncoderId];
      }
      positiveId = id;
    } else if (!options.existingRefModEncoderId) {
      positiveId = "smart_refmod_encode";
      graph[positiveId] = {class_type: "MiniMaxH3RefModTextEncode", inputs: {clip: inputs.clip, vae: inputs.vae, prompt: inputs.prompt, mods: [loaderId, 0], reference_fps: 24, max_total_tokens: 0}};
      replaceConditioning(graph, id, positiveId, [positiveId]);
    }
  }
  if (smart.useFirstFrame) {
    if (!options.firstFrameFilename || !inputs.vae) throw Error("The first-frame image and H3 video VAE must be bound.");
    if (graph.smart_first_frame || graph.smart_frame_zero) throw Error("First-frame graph node collision.");
    graph.smart_first_frame = {class_type: "LoadImage", inputs: {image: options.firstFrameFilename}};
    graph.smart_frame_zero = {class_type: "MiniMaxH3AddGuide", inputs: {positive: [positiveId, 0], latent: [id, 1], frame_idx: 0, vae: inputs.vae, image: ["smart_first_frame", 0]}};
    replaceConditioning(graph, positiveId, "smart_frame_zero", ["smart_frame_zero"]);
  }
}

/** Validates the actual conditioning node and translates only the reviewed mixed recipe. */
export function applyH3CharacterVoiceGraph(graph: H3PromptGraph, plan: H3CharacterVoicePlan, mode: ProductionV2H3Mode, audioFilenames: string[], imageFilenames: string[]) {
  const id = H3_WORKFLOW_CONTRACTS[mode].conditioningNodeId;
  const node = graph[id];
  const linked = (type: string, field: string, input: unknown, expected: string) => {
    if (!Array.isArray(input) || input[1] !== 0 || graph[input[0]]?.class_type !== type || graph[input[0]].inputs[field] !== expected) throw Error("H3 could not bind the reviewed reference to its encoder input.");
    return input;
  };
  if (mode !== "h3-reference-to-video") {
    if (plan.recipe !== "native" || node?.class_type !== "MiniMaxH3ImageToVideo" || audioFilenames.length || imageFilenames.length) throw Error("The selected base H3 mode does not accept cast reference inputs.");
    return;
  }
  if (node?.class_type !== "MiniMaxH3ReferenceToVideo") throw Error("The H3 reference encoder does not match the reviewed graph.");
  const inputs = node.inputs;
  const incomingAudio = audioFilenames.map((filename, index) => linked("LoadAudio", "audio", inputs[`ref_audios.ref_audio_${index}`], filename));
  imageFilenames.forEach((filename, index) => linked("LoadImage", "image", inputs[`ref_images.ref_image_${index}`], filename));
  if (plan.recipe === "native") return;

  if (!plan.refMods.length || !inputs.vae || !inputs.audio_vae || imageFilenames.length) throw Error("The selected RefMods need the matching H3 encoders and valid reference inputs.");
  if (plan.recipe === "combined-refmod" && incomingAudio.length) throw Error("This comparison uses the saved combined RefMods for audio.");
  if (plan.recipe === "visual-refmod" && (incomingAudio.length || plan.refMods.some(slot => slot.components !== "Visual" || slot.audioStrength !== 0))) throw Error("The visual RefMod workflow must exclude audio.");
  if (plan.recipe === "visual-refmod-wav" && (!incomingAudio.length || incomingAudio.length > 3 || plan.refMods.some(slot => slot.components !== "Visual" || slot.audioStrength !== 0))) throw Error("The mixed comparison requires visual-only RefMods and one to three saved WAV references.");
  const loaderId = "character_voice_refmods", bundleId = "character_voice_wavs";
  if (graph[loaderId] || graph[bundleId]) throw Error("The H3 cast graph has a node ID collision.");
  graph[loaderId] = { class_type: "MiniMaxH3RefModsLoader", inputs: h3SmartRefModLoaderInputs(plan.refMods) };
  const combined: Record<string, unknown> = { mods: [loaderId, 0], vlm_resolution: 0, vlm_video_resolution: 0, reference_fps: 24, max_total_tokens: 0 };
  for (const key of ["clip", "vae", "audio_vae", "prompt", "width", "height", "length", "ref_image_size"]) {
    if (inputs[key] !== undefined) combined[key] = inputs[key];
  }
  if (incomingAudio.length) {
    graph[bundleId] = { class_type: "SLRH3ReferenceMediaBundle", inputs: Object.fromEntries(incomingAudio.map((value, index) => [`audio_${index}`, value])) };
    combined.references = [bundleId, 0];
  }
  if (!Object.entries(graph).some(([key, candidate]) => key !== id && Object.values(candidate.inputs).some(value => Array.isArray(value) && value[0] === id && value[1] === 0))) throw Error("The reviewed H3 encoder conditioning has no sampler consumer.");
  node.class_type = "PK_MiniMaxH3Combined";
  node.inputs = combined;
}

/** Validate the assembled worker graph, including expansion of composite reference inputs. */
export function assertNativeH3AudioGraph(graph: H3PromptGraph) {
  for (const node of Object.values(graph)) {
    const inputs = node.inputs;
    if (node.class_type === "MiniMaxH3AddGuide" && (inputs.audio !== undefined || inputs.audio_latent !== undefined) || node.class_type === "LoadAudio" || node.class_type === "SLRH3ReferenceMediaBundle" &&
      Object.keys(inputs).some(key => /^audio_|^video_audio_/.test(key)) ||
      Object.keys(inputs).some(key => /^ref_audios?(?:\.|_|$)|^ref_video_audios?(?:\.|_|$)|^refs_audio(?:\.|_|$)|^refs_video_audio(?:\.|_|$)/.test(key))) {
      throw Error("Native H3 audio cannot use imported audio references.");
    }
    if (node.class_type === "MiniMaxH3RefModsLoader") {
      for (const name of Object.keys(inputs).filter(key => /^mod_\d+$/.test(key))) {
        const slot = name.slice(4);
        if (inputs[name] !== "(none)" && Number(inputs[`strength_${slot}`] ?? 1) > 0 &&
          (inputs[`components_${slot}`] !== "Visual" || inputs[`audio_strength_${slot}`] !== 0)) {
          throw Error("The worker graph must load only visual RefMod components.");
        }
      }
    }
  }
}
