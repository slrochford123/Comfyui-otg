import type { H3PromptGraph, ProductionV2H3BackendId } from "@/lib/production/h3Workflows";

/** Owner-selected C benchmark. Not a Ref2VA/FL2VA acceleration adapter. */
export const H3_OMNIREF = {
  id: "fasth3-omniref-r2v-c-v1",
  checkpoint: "fasth3_omniref_8step_pruned_int8_convrot.safetensors",
  sha256: "851b2dc9670ed864b7f1e951ac9da047d83b1c04ded9bfcc1a9e5bba0ee33f80",
  bytes: 22213723064,
  revision: "82eff2a6eee6c962846879f4bab52610a4df24d3",
  source: "https://huggingface.co/FastVideo/FastH3-Omni-Comfy",
  steps: 8,
} as const;
export function h3OmniRefEncoder(backend: ProductionV2H3BackendId) {
  return backend === "rtx3090" ? "qwen3vl_32b_minimax_h3_int8_convrot.safetensors"
    : "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors";
}
/** Shared overlay after authorized media binding. No network, fallback, or file paths. */
export function applyH3OmniRef(graph: H3PromptGraph, backend: ProductionV2H3BackendId) {
  for (const id of ["30", "15", "38", "41", "164", "24", "18"]) {
    if (!graph[id]) throw new Error("OmniRef workflow contract is incomplete.");
  }
  graph["30"].inputs.unet_name = H3_OMNIREF.checkpoint;
  graph["15"].inputs.clip_name = h3OmniRefEncoder(backend);
  // Never stack the previous acceleration adapter or automatic Singularity
  // modifiers on a different checkpoint. Explicit user style stacks remain explicit.
  const removed = new Set(["36", "9001", "9002"]);
  for (const id of removed) delete graph[id];
  for (const node of Object.values(graph)) {
    const link = node.inputs.model;
    if (Array.isArray(link) && removed.has(String(link[0]))) node.inputs.model = ["30", 0];
  }
  graph["38"].inputs.shift_video = 12;
  graph["38"].inputs.shift_audio = 3;
  graph["41"] = { class_type: "ModelAttentionBackend", inputs: { model: ["38", 0], attention: "comfy kitchen attention" } };
  if (graph["omni_vsa"]) throw new Error("OmniRef sparse node collision.");
  graph["omni_vsa"] = { class_type: "BlockSparseAttention", inputs: {
    model: ["41", 0], selection: "vsa", "selection.keep_percent": 10,
    start_percent: 0, end_percent: 1, dense_blocks: "", min_tokens: 12288,
    extra_tokens: 256, sink_conditioning: "exact_kv_and_rows", verbose: true,
  } };
  graph["164"].inputs.model = ["omni_vsa", 0];
  graph["24"].inputs.model = ["164", 0];
  graph["24"].inputs.steps = 8;
  graph["24"].inputs.scheduler = "simple";
  graph["24"].inputs.denoise = 1;
  graph["18"].inputs.sampler_name = "euler";
  // Match C's preview wrapper on both sampling consumers, not a disconnected node.
  graph["32"].inputs.model = ["164", 0];
  return graph;
}
