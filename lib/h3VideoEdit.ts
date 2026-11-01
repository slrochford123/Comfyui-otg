import path from "node:path";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { probeVideoInfo } from "@/lib/videoFrame";
import type { H3PromptGraph } from "@/lib/production/h3Workflows";
import { videoEditDuration } from "@/lib/videoEditDuration";
import { DEFAULT_H3_STUDIO_PLAN } from "@/lib/h3StudioPlan";
import { finalizeH3StudioAudio } from "@/lib/h3StudioAudio";

export function h3VideoEditFrameCount(duration: number) {
  duration = videoEditDuration(duration);
  return Math.max(124, Math.ceil((Math.ceil(duration * 24) - 5) / 17) * 17 + 5);
}
export function h3VideoEditCanvas(width: number, height: number) {
  if (!(width > 0 && height > 0)) throw new Error("A readable video stream is required.");
  const scale = Math.sqrt((608 * 352) / (width * height));
  return { width: Math.max(32, Math.round(width * scale / 32) * 32), height: Math.max(32, Math.round(height * scale / 32) * 32) };
}
export async function prepareH3VideoEditSource(source: string, duration: number, width: number, height: number) {
  const frames = h3VideoEditFrameCount(duration);
  const target = path.join(path.dirname(source), "source-conditioned.mp4");
  const result = await runCmd(resolveFfmpegPath(), ["-nostdin", "-y", "-i", source, "-map", "0:v:0", "-vf", `fps=24,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,tpad=stop_mode=clone:stop_duration=6`, "-frames:v", String(frames), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", target], { timeoutMs: 60000 });
  if (result.code !== 0) throw new Error("Could not prepare the source video for H3 editing.");
  return target;
}
/** Native structural V2V: every source frame drives the H3 Fun ControlNet.
 * Full denoising makes appearance edits possible; Canny retains source geometry
 * without forcing the old colors back into the sampled latent. No R2V reference
 * or first-frame substitution. Uses Comfy-Org's existing reviewed model patch.
 */
export function applyH3VideoEditGraph(graph: H3PromptGraph, filename: string, duration: number, width: number, height: number) {
  const frames = h3VideoEditFrameCount(duration);
  graph["39"].inputs.length = frames;
  graph["39"].inputs.width = width;
  graph["39"].inputs.height = height;
  delete graph["39"].inputs.first_frame;
  delete graph["39"].inputs.last_frame;
  graph["v2v_source"] = { class_type: "LoadVideo", inputs: { file: filename } };
  graph["v2v_frames"] = { class_type: "GetVideoComponents", inputs: { video: ["v2v_source", 0] } };
  delete graph.v2v_encode;
  delete graph.v2v_init;
  graph["v2v_canny"] = { class_type: "Canny", inputs: { image: ["v2v_frames", 0], low_threshold: 0.4, high_threshold: 0.8 } };
  graph["v2v_control_model"] = { class_type: "ModelPatchLoader", inputs: { name: "minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors" } };
  graph["v2v_control"] = { class_type: "MiniMaxH3FunControlNetApply", inputs: { model: ["38", 0], model_patch: ["v2v_control_model", 0], vae: ["3", 0], strength: 1, start_percent: 0, end_percent: 1, control_video: ["v2v_canny", 0] } };
  // Keep the installed native base model, attention and preview chain. Insert
  // only the structural patch; never create a self-reference or bypass SLA.
  for (const [id, node] of Object.entries(graph)) {
    if (id !== "v2v_control" && Array.isArray(node.inputs.model) && node.inputs.model[0] === "38") node.inputs.model = ["v2v_control", 0];
  }
  graph["21"].inputs.latent_image = ["39", 1];
  graph["24"] = { class_type: "BasicScheduler", inputs: { scheduler: "simple", steps: 25, denoise: 1, model: ["v2v_control", 0] } };
  return graph;
}
export async function finalizeH3VideoEdit(output: string, duration: number, source: string) {
  duration = videoEditDuration(duration);
  const probe = await probeVideoInfo(source);
  return finalizeH3StudioAudio(output, { ...DEFAULT_H3_STUDIO_PLAN, workflowId: "reference-edit", durationSeconds: duration,
    audio: probe.hasAudio ? "original" : "mute" }, source);
}
