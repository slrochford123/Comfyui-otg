import {
  H3_ORIENTATION_OPTIONS,
  H3_PRODUCTION_DURATION_OPTIONS,
  H3_QUALITY_OPTIONS,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import { appendProtectedDialogueBlock, detectProtectedDialogue } from "@/lib/promptDialogue";

export type H3BodySwapRequestInput = {
  prompt?: unknown;
  selector?: unknown;
  quality?: unknown;
  orientation?: unknown;
  durationSeconds?: unknown;
  preserveOriginalAudio?: unknown;
};

export type H3BodySwapCompileInput = {
  prompt?: string;
  selector: string;
  preserveOriginalAudio?: boolean;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeH3BodySwapSelector(value: unknown) {
  return clean(value) || "person";
}

export function compileH3BodySwapPrompt(input: H3BodySwapCompileInput) {
  const selector = normalizeH3BodySwapSelector(input.selector);
  const instruction = clean(input.prompt);
  const protectedInstruction = instruction ? appendProtectedDialogueBlock(instruction) : "";
  const protectedDialogue = detectProtectedDialogue(instruction);
  return [
    "subject_definitions:",
    "<Subject 1> is the replacement person whose visual identity, facial features, skin tone, hairstyle, body build, and attire are strictly derived from <Picture 1>.",
    `<Video 1> is the source video. SAM3 tracks the target described as "${selector}" and supplies a dynamic solid black silhouette mask that defines the exact spatial footprint for <Subject 1>.`,
    "",
    "summary:",
    "[single-person body swap + video inpainting + reference synthesis] The target video replaces only the tracked/masked person from <Video 1> with <Subject 1> from <Picture 1>. The original scene, camera motion, perspective, background, lighting, and non-target people or objects remain preserved.",
    "",
    "retention_analysis:",
    "<Subject 1>: fully_preserved - identity, facial anatomy, skin tone, hairstyle, body build, and recognizable attire are derived from <Picture 1>.",
    "<Video 1>: background_preserved - camera trajectory, lens feel, body placement, temporal motion, lighting, occlusion, and all unmasked surroundings are retained from the source video.",
    "",
    "detailed_description:",
    "[Shot 1] <Subject 1> is synthesized precisely inside the SAM3 tracked mask for the selected target. The replacement fills the tracked region naturally from the first frame through the final frame, matching the source person's scale, pose, body placement, timing, and motion continuity. Ambient light wrap, realistic contact shadows, correct occlusion, and seamless edge blending integrate <Subject 1> into the environment. No residual black border, matte halo, visible silhouette edge, flicker, or identity bleed remains around the mask.",
    protectedInstruction ? `Additional user instruction: ${protectedInstruction}` : "",
    protectedDialogue.hasDialogue
      ? "Protected dialogue is present. Preserve each quoted line, speaker, delivery, and ordering exactly."
      : "",
    "",
    "overall_soundscape:",
    input.preserveOriginalAudio
      ? "The app preserves the original source-video audio after rendering by remuxing it with the final visual result."
      : "Complete ambient silence. No dialogue, no speech, no vocals.",
    "",
    "non_diegetic_music:",
    input.preserveOriginalAudio ? "Use the original source-video soundtrack only." : "N/A",
  ].filter((line) => line !== "").join("\n");
}

export function validateH3BodySwapRequest(input: H3BodySwapRequestInput) {
  const quality = clean(input.quality) as H3Quality;
  const orientation = clean(input.orientation) as H3Orientation;
  const durationSeconds = Number(input.durationSeconds) as H3ProductionDuration;
  if (!H3_QUALITY_OPTIONS.includes(quality)) throw new Error("Choose SH, LQ, or HQ.");
  if (!H3_ORIENTATION_OPTIONS.includes(orientation)) throw new Error("Choose Landscape or Portrait orientation.");
  if (!H3_PRODUCTION_DURATION_OPTIONS.includes(durationSeconds)) throw new Error("Choose a 5- or 10-second duration.");
  return {
    prompt: clean(input.prompt),
    selector: normalizeH3BodySwapSelector(input.selector),
    quality,
    orientation,
    durationSeconds,
    preserveOriginalAudio: input.preserveOriginalAudio !== false,
  };
}
