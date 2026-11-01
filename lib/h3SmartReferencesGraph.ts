import type { H3PromptGraph } from "@/lib/production/h3Workflows";
import type { H3RefModSlot } from "@/lib/h3SpecialModes/refMods";
import type { H3SmartReferenceInput } from "@/lib/h3SmartReferences";
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
