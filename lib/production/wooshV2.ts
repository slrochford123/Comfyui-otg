import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { safeJoin, safeSegment } from "@/lib/paths";
import { downloadH3Video, getH3PromptHistory, submitH3Prompt, uploadH3Input } from "@/lib/production/h3Comfy";
import { H3_BACKEND_PROFILES, type H3PromptGraph } from "@/lib/production/h3Workflows";
import { probeProductionV2Media, productionV2SceneOutputRoot } from "@/lib/production/postProduction";

export const PRODUCTION_V2_WOOSH_BACKEND = "rtx3090" as const;
export const PRODUCTION_V2_WOOSH_MODEL = "Woosh-VFlow-8s" as const;
export const PRODUCTION_V2_WOOSH_LICENSE = "CC-BY-NC-4.0 (public model weights; non-commercial)" as const;
export const PRODUCTION_V2_WOOSH_MAX_SECONDS = 8;

const WORKFLOW_FILE = "comfy_workflows/internal/edit-video/sony_woosh_v2a.json";
const REQUIRED_NODES = ["WooshLoadFlow", "WooshTextEncode", "WooshLoadVideo", "WooshSample", "VHS_LoadVideo", "VHS_VideoCombine"] as const;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function inspectProductionV2Woosh(fetcher: typeof fetch = fetch) {
  try {
    const entries = await Promise.all(REQUIRED_NODES.map(async (node) => {
      const response = await fetcher(`${H3_BACKEND_PROFILES[PRODUCTION_V2_WOOSH_BACKEND].baseUrl}/object_info/${encodeURIComponent(node)}`, { cache: "no-store" });
      if (!response.ok) return [node, false] as const;
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      return [node, Boolean(payload?.[node])] as const;
    }));
    const missingNodes = entries.filter(([, present]) => !present).map(([node]) => node);
    return { ready: missingNodes.length === 0, backend: PRODUCTION_V2_WOOSH_BACKEND, model: PRODUCTION_V2_WOOSH_MODEL, missingNodes };
  } catch (error) {
    return { ready: false, backend: PRODUCTION_V2_WOOSH_BACKEND, model: PRODUCTION_V2_WOOSH_MODEL, missingNodes: [...REQUIRED_NODES], error: error instanceof Error ? error.message : String(error) };
  }
}

export function buildProductionV2WooshGraph(args: { videoInputName: string; prompt: string; durationSeconds: number; seed: number; filenamePrefix: string }) {
  const graph = JSON.parse(fs.readFileSync(path.join(process.cwd(), WORKFLOW_FILE), "utf8")) as H3PromptGraph & { __otg?: unknown };
  delete graph.__otg;
  for (const [nodeId, classType] of [["7", "WooshLoadFlow"], ["19", "WooshTextEncode"], ["33", "VHS_VideoCombine"], ["34", "VHS_LoadVideo"], ["37", "WooshLoadVideo"], ["38", "WooshSample"]] as const) {
    if (graph[nodeId]?.class_type !== classType) throw new Error(`Woosh workflow expected node ${nodeId} to be ${classType}.`);
  }
  delete graph["45"];
  delete graph["46"];
  delete graph["9"];
  const duration = Math.max(1, Math.min(PRODUCTION_V2_WOOSH_MAX_SECONDS, Number(args.durationSeconds) || PRODUCTION_V2_WOOSH_MAX_SECONDS));
  graph["7"].inputs.model_name = PRODUCTION_V2_WOOSH_MODEL;
  graph["7"].inputs.model_type = "VFlow";
  graph["19"].inputs.mode = "V2A — video to audio (VFlow/DVFlow)";
  graph["34"].inputs.video = clean(args.videoInputName);
  graph["34"].inputs.force_rate = 25;
  graph["34"].inputs.frame_load_cap = Math.max(1, Math.floor(duration * 25) + 1);
  graph["34"].inputs.skip_first_frames = 0;
  graph["34"].inputs.select_every_nth = 1;
  graph["34"].inputs.format = "LTXV";
  graph["37"].inputs.video_path = "";
  graph["37"].inputs.max_duration_s = duration;
  graph["37"].inputs.image_batch = ["34", 0];
  graph["38"].inputs.prompt = clean(args.prompt) || "Synchronized natural sound effects matching the visible action.";
  graph["38"].inputs.steps = 50;
  graph["38"].inputs.cfg = 4.5;
  graph["38"].inputs.seed = Math.max(0, Math.floor(args.seed));
  graph["38"].inputs.latent_frames = Math.max(100, Math.floor(duration * 100) + 1);
  graph["38"].inputs.subprocess = false;
  graph["38"].inputs.force_offload = false;
  graph["38"].inputs.gen_model = ["7", 0];
  graph["38"].inputs.text_conditioning = ["19", 0];
  graph["38"].inputs.video = ["37", 0];
  graph["33"].inputs.frame_rate = 25;
  graph["33"].inputs.filename_prefix = clean(args.filenamePrefix);
  graph["33"].inputs.format = "video/h264-mp4";
  graph["33"].inputs.pix_fmt = "yuv420p";
  graph["33"].inputs.crf = 19;
  graph["33"].inputs.save_output = true;
  graph["33"].inputs.images = ["38", 0];
  graph["33"].inputs.audio = ["38", 1];
  return { graph, durationSeconds: duration, workflowFile: WORKFLOW_FILE };
}

async function waitForWoosh(promptId: string) {
  const started = Date.now();
  while (Date.now() - started < 20 * 60_000) {
    const history = await getH3PromptHistory(PRODUCTION_V2_WOOSH_BACKEND, promptId);
    if (history.state === "completed" && history.video) return history.video;
    if (history.state === "failed") throw new Error("Sony Woosh VFlow failed in ComfyUI.");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Timed out waiting for Sony Woosh VFlow output.");
}

export async function generateProductionV2WooshSfx(args: {
  ownerKey: string;
  productionId: string;
  sceneId: string;
  sourcePath: string;
  prompt: string;
  sfxVolume: number;
}) {
  const dependency = await inspectProductionV2Woosh();
  if (!dependency.ready) throw new Error(`Sony Woosh VFlow is unavailable on the RTX 3090. Missing nodes: ${dependency.missingNodes.join(", ")}`);
  const sourceProbe = await probeProductionV2Media(args.sourcePath);
  const operationId = `woosh-${randomUUID()}`;
  const uploaded = await uploadH3Input({ backend: PRODUCTION_V2_WOOSH_BACKEND, sourcePath: args.sourcePath, mediaType: "video", uploadName: operationId });
  const seed = Math.floor(Math.random() * 2_147_483_647);
  const built = buildProductionV2WooshGraph({
    videoInputName: uploaded,
    prompt: args.prompt,
    durationSeconds: sourceProbe.durationSeconds,
    seed,
    filenamePrefix: `otg_production_v2/woosh/${safeSegment(operationId)}`,
  });
  const submitted = await submitH3Prompt({ backend: PRODUCTION_V2_WOOSH_BACKEND, graph: built.graph, clientId: `otg-production-v2-woosh-${randomUUID()}`, jobId: operationId });
  if (!submitted.accepted) throw new Error(submitted.error);
  const output = await waitForWoosh(submitted.promptId);
  const rawVideoPath = await downloadH3Video({
    backend: PRODUCTION_V2_WOOSH_BACKEND,
    file: output,
    ownerKey: args.ownerKey,
    productionId: args.productionId,
    sceneId: args.sceneId,
    generationJobId: operationId,
  });
  const versionRoot = productionV2SceneOutputRoot(args.ownerKey, args.productionId, args.sceneId);
  const rawAudioPath = safeJoin(versionRoot, `${safeSegment(operationId)}-sfx.wav`);
  const extract = await runCmd(resolveFfmpegPath(), ["-y", "-hide_banner", "-i", rawVideoPath, "-map", "0:a:0", "-ar", "48000", "-ac", "2", rawAudioPath], { timeoutMs: 10 * 60_000 });
  if (extract.code !== 0) throw new Error(`Could not preserve the generated Woosh SFX asset: ${extract.stderr || extract.stdout}`);
  const outputPath = safeJoin(versionRoot, `${safeSegment(operationId)}-mixed.mp4`);
  const sfxVolume = Math.max(0, Math.min(2, Number(args.sfxVolume)));
  const command = ["-y", "-hide_banner", "-i", args.sourcePath, "-i", rawAudioPath];
  if (sourceProbe.hasAudio) {
    command.push("-filter_complex", `[0:a]aresample=48000[base];[1:a]volume=${sfxVolume.toFixed(4)},apad[sfx];[base][sfx]amix=inputs=2:duration=first:dropout_transition=2[a]`, "-map", "0:v:0", "-map", "[a]");
  } else {
    command.push("-filter_complex", `[1:a]volume=${sfxVolume.toFixed(4)},apad,atrim=duration=${sourceProbe.durationSeconds.toFixed(3)}[a]`, "-map", "0:v:0", "-map", "[a]");
  }
  command.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", outputPath);
  const mix = await runCmd(resolveFfmpegPath(), command, { timeoutMs: 20 * 60_000 });
  if (mix.code !== 0) throw new Error(`Could not mix Sony Woosh SFX into the selected video: ${mix.stderr || mix.stdout}`);
  return {
    outputPath,
    rawSfxAudioPath: rawAudioPath,
    rawWooshVideoPath: rawVideoPath,
    promptId: submitted.promptId,
    operationId,
    model: PRODUCTION_V2_WOOSH_MODEL,
    backend: PRODUCTION_V2_WOOSH_BACKEND,
    prompt: args.prompt,
    seed,
    sfxVolume,
    generatedDurationSeconds: built.durationSeconds,
    sourceDurationSeconds: sourceProbe.durationSeconds,
    durationWasCapped: sourceProbe.durationSeconds > built.durationSeconds,
    probe: await probeProductionV2Media(outputPath),
  };
}
