import { H3_STYLE_PRESETS, resolveH3StylePreset } from "@/lib/h3StylePresets";
import { H3_CAMERA_FEEL_OPTIONS, H3_SHOT_FLOW_OPTIONS, H3_VISUAL_STYLE_OPTIONS, h3StyleProfile } from "@/lib/production/promptOptions";
import type { LabSettings } from "./catalog";

export const DEFAULT_LAB_CREATIVE = { stylePresetId: "none", visualStyle: "Cinematic realism", cameraFeel: "Automatic cinematic camera", shotFlow: "Let H3 decide" };
export const LAB_STYLE_IDS = new Set(H3_STYLE_PRESETS.map(s => s.id));
export { H3_CAMERA_FEEL_OPTIONS, H3_SHOT_FLOW_OPTIONS, H3_VISUAL_STYLE_OPTIONS };
/** Prompt-only look controls; never silently load a model or acceleration adapter. */
export function labFinalPrompt(settings: LabSettings, triggers: string[] = []) {
  const preset = resolveH3StylePreset(settings.stylePresetId || "none");
  const parts = [settings.prompt.trim()];
  if (preset?.id !== "none" && preset?.masterPrompt) parts.push(preset.masterPrompt);
  else if (settings.visualStyle && settings.visualStyle !== DEFAULT_LAB_CREATIVE.visualStyle) parts.push(h3StyleProfile(settings.visualStyle));
  if (settings.cameraFeel && settings.cameraFeel !== DEFAULT_LAB_CREATIVE.cameraFeel) parts.push(`Camera: ${settings.cameraFeel}.`);
  if (settings.shotFlow && settings.shotFlow !== DEFAULT_LAB_CREATIVE.shotFlow) parts.push(`Shot flow: ${settings.shotFlow}.`);
  for (const trigger of triggers) if (trigger && !parts.join("\n").toLowerCase().includes(trigger.toLowerCase())) parts.push(trigger);
  return parts.join("\n");
}
export const labH3Mode = (mode: LabSettings["mode"]) => mode === "text" ? "h3-text-to-video" : mode === "image" ? "h3-image-to-video" : "h3-reference-to-video";
