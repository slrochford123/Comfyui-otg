import type { H3PromptGraph } from "@/lib/production/h3Workflows";

/** The completed 5060 Ti café R2V profile, not a new checkpoint or post-upscaler. */
export const H3_SELF_LIFT = {
  id: "selflift-fasth3-omniref-r2v-v1",
  nodeClass: "SelfLiftH3Sampler",
  source: "https://github.com/facok/comfyui-SelfLift",
  revision: "835c3cf7919410f71f414688f049c6ca497789d0",
  upscaler: "minimax_h3_latent_upscaler_3d_fp16.safetensors",
  upscalerSha256: "043e5a48e161610ef6c3ea974645220354d06fa618abca15f76d084812eb55c2",
  upscalerBytes: 690592672,
} as const;

/** Apply only after the OmniRef profile/media binding. Keep AV and preview paths. */
export function applyH3SelfLift(graph: H3PromptGraph): H3PromptGraph {
  if (graph["21"]?.class_type !== "SamplerCustomAdvanced" || !graph["omni_vsa"]
    || graph["24"]?.inputs.steps !== 8 || graph["18"]?.inputs.sampler_name !== "euler"
    || !graph["39"] || !graph["164"] || !graph["3"] || !graph["31"]
    || graph["selflift_negative"]) throw new Error("SelfLift requires the complete eight-step OmniRef reference graph.");
  graph["selflift_negative"] = { class_type: "ConditioningZeroOut", inputs: { conditioning: ["39", 0] } };
  graph["21"] = {
    class_type: H3_SELF_LIFT.nodeClass,
    inputs: {
      model: ["164", 0], positive: ["39", 0], negative: ["selflift_negative", 0],
      vae: ["3", 0], latent_image: ["39", 1], sampler: ["18", 0], sigmas: ["24", 0],
      seed: graph["31"].inputs.noise_seed, cfg: 1, transition_step: 6, lowres_scale: 0.5,
      rho: 0, w_min: 0.5, w_max: 1, upscaler_model: H3_SELF_LIFT.upscaler,
      upscaler_unload: true, highres_tiling: false,
    },
    _meta: { title: "SelfLift · FastH3 OmniRef · 6 low + 2 full-resolution steps" },
  };
  // SamplerCustomAdvanced's denoised output was slot 1; SelfLift has one AV output.
  for (const node of Object.values(graph)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && value.length === 2 && value[0] === "21") node.inputs[key] = ["21", 0];
    }
  }
  return graph;
}
