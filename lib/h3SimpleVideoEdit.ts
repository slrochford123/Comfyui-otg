import crypto from "node:crypto";
import { DEFAULT_H3_STUDIO_PLAN, parseH3StudioPlan, type H3StudioPlan } from "@/lib/h3StudioPlan";
import type { VideoProbeInfo } from "@/lib/videoFrame";

/** Only source identity, creative prompt and size cross the browser boundary. */
export function parseSimpleVideoEdit(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Choose a video and enter an edit prompt.");
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some(k => !["sourceId", "prompt", "quality", "requestId", "backend"].includes(k))) throw Error("Unsupported video edit control.");
  const backend = p.backend ?? "rtx3090";
  if (backend !== "rtx3090" && backend !== "rtx5060ti") throw Error("Choose RTX 3090 or RTX 5060 Ti.");
  if (typeof p.sourceId !== "string" || !/^[a-f0-9-]{36}$/i.test(p.sourceId)) throw Error("Select the source video again.");
  if (typeof p.prompt !== "string" || !p.prompt.trim() || p.prompt.length > 4000) throw Error("Enter an edit prompt between 1 and 4000 characters.");
  if (!["0.2", "0.6", "1"].includes(String(p.quality))) throw Error("Choose 0.2, 0.6 or 1 MP.");
  if (typeof p.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(p.requestId)) throw Error("Invalid video edit request ID.");
  const input = { sourceId: p.sourceId, prompt: p.prompt.trim(), quality: p.quality as H3StudioPlan["quality"], requestId: p.requestId, backend };
  return { ...input, requestFingerprint: crypto.createHash("sha256").update(JSON.stringify([input.sourceId, input.prompt, input.quality, input.backend])).digest("hex") };
}
export function simpleVideoEditPlan(input: ReturnType<typeof parseSimpleVideoEdit>, probe: VideoProbeInfo) {
  const duration = probe.durationSeconds, width = probe.displayWidth ?? probe.width, height = probe.displayHeight ?? probe.height;
  if (!probe.codec || !width || !height) throw Error("Choose a readable video file.");
  if (duration == null || !Number.isFinite(duration) || duration < 2 || duration > 10) throw Error("Trim the video to between 2 and 10 seconds.");
  return parseH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, backend: input.backend, workflowId: "reference-edit", checkpoint: "standard", profile: "ref2va-8step",
    quality: input.quality, durationSeconds: duration, orientation: height > width ? "portrait" : "landscape",
    attention: "project-sla", steps: 8, sampler: "euler", scheduler: "simple", seed: crypto.randomInt(0, 2147483647),
    prompt: input.prompt, originalPrompt: input.prompt, audio: "generated", loras: [], combatEnabled: false });
}
