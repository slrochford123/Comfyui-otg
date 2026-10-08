import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { safeJoin, safeSegment } from "@/lib/paths";
import {
  downloadH3VideoFromBaseUrl,
  getH3PromptHistoryFromBaseUrl,
  submitH3PromptToBaseUrl,
  uploadH3InputToBaseUrl,
} from "@/lib/production/h3Comfy";
import { H3_BACKEND_PROFILES, type H3PromptGraph, type ProductionV2H3BackendId } from "@/lib/production/h3Workflows";

export const H3_RIFE_NATIVE_FPS = 24;
export const H3_RIFE_TARGET_FPS = 60;
export const H3_RIFE_TARGET_MODEL = "rife47.pth";
export const H3_RIFE_UNAVAILABLE_MESSAGE = "60 FPS interpolation is unavailable on this backend.";

type ObjectInfo = Record<string, {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
}>;

export type H3Rife60FpsWorkflowInput = {
  videoFilename: string;
  outputPrefix: string;
};

export type H3Rife60FpsResult = {
  enabled: boolean;
  nativeFps: typeof H3_RIFE_NATIVE_FPS;
  finalFps: typeof H3_RIFE_TARGET_FPS;
  promptId: string;
  workflowId: "h3-rife-60fps";
  workflowFile: string;
  rawOutputPath: string;
  outputPath: string;
};

export type H3RifeCompatibility = {
  compatible: boolean;
  missingNodes: string[];
  missingAssets: string[];
  method: "RIFE_FPS_Resample";
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function choices(info: ObjectInfo, node: string, input: string): string[] {
  const descriptor =
    info[node]?.input?.required?.[input]
    ?? info[node]?.input?.optional?.[input];
  if (!Array.isArray(descriptor)) return [];
  const first = descriptor[0];
  if (Array.isArray(first)) return first.map(clean).filter(Boolean);
  if (first && typeof first === "object" && Array.isArray((first as { options?: unknown }).options)) {
    return ((first as { options: unknown[] }).options).map(clean).filter(Boolean);
  }
  const second = descriptor[1];
  if (second && typeof second === "object" && Array.isArray((second as { options?: unknown }).options)) {
    return ((second as { options: unknown[] }).options).map(clean).filter(Boolean);
  }
  return [];
}

function abortAfter(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
  const timeout = abortAfter(timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: timeout.signal });
    if (!response.ok) return null;
    return await response.json().catch(() => null) as T | null;
  } finally {
    timeout.cancel();
  }
}

export function normalizeH3RifeInterpolation60Fps(value: unknown) {
  return value === true || clean(value).toLowerCase() === "true";
}

export function h3FinalFpsForRife(enabled: unknown) {
  return normalizeH3RifeInterpolation60Fps(enabled)
    ? H3_RIFE_TARGET_FPS
    : H3_RIFE_NATIVE_FPS;
}

export function buildH3Rife60FpsWorkflow(input: H3Rife60FpsWorkflowInput) {
  const videoFilename = clean(input.videoFilename);
  if (!videoFilename) throw new Error("RIFE source video filename is required.");
  const outputPrefix = clean(input.outputPrefix).replace(/[^a-zA-Z0-9_./-]/g, "_");
  if (!outputPrefix) throw new Error("RIFE output prefix is required.");

  const graph: H3PromptGraph = {
    "1": {
      class_type: "VHS_LoadVideo",
      inputs: {
        video: videoFilename,
        force_rate: 0,
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: 0,
        skip_first_frames: 0,
        select_every_nth: 1,
      },
      _meta: { title: "Load completed H3 video at native timing" },
    },
    "2": {
      class_type: "RIFE_FPS_Resample",
      inputs: {
        ckpt_name: H3_RIFE_TARGET_MODEL,
        frames: ["1", 0],
        fps_in: H3_RIFE_NATIVE_FPS,
        fps_out: H3_RIFE_TARGET_FPS,
        scale_factor: 1,
        ensemble: true,
        linearize: false,
        lf_guardrail: false,
        lf_sigma: 13,
        source_pair_match: false,
        match_a_cap: 0.02,
        match_b_cap: 0.00784313725490196,
        edge_band_lock: false,
        tau_low: 0.0058823529411764705,
        tau_high: 0.023529411764705882,
        band_radius: 4,
        band_soft_sigma: 2,
        clear_cache_after_n_frames: 10,
      },
      _meta: { title: "RIFE exact 24 FPS to 60 FPS" },
    },
    "3": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["2", 0],
        frame_rate: H3_RIFE_TARGET_FPS,
        loop_count: 0,
        filename_prefix: outputPrefix,
        format: "video/h264-mp4",
        pix_fmt: "yuv420p",
        crf: 19,
        save_metadata: true,
        trim_to_audio: false,
        pingpong: false,
        save_output: true,
      },
      _meta: { title: "Encode 60 FPS MP4" },
    },
  };

  return {
    workflowId: "h3-rife-60fps" as const,
    workflowFile: "comfy_workflows/internal/h3-finalization/rife-60fps.api.json",
    outputNodeId: "3",
    graph,
  };
}

export async function inspectH3Rife60FpsCompatibility(baseUrl: string): Promise<H3RifeCompatibility> {
  const base = baseUrl.replace(/\/+$/, "");
  const requiredNodes = ["VHS_LoadVideo", "RIFE_FPS_Resample", "VHS_VideoCombine"];
  const entries = await Promise.all(
    requiredNodes.map(async (node) => {
      const payload = await fetchJsonWithTimeout<ObjectInfo>(`${base}/object_info/${encodeURIComponent(node)}`);
      return [node, payload?.[node] ? payload : null] as const;
    }),
  );
  const info = Object.fromEntries(
    entries
      .filter((entry) => entry[1])
      .flatMap(([node, payload]) =>
        Object.entries(payload || {}).filter(([key]) => key === node),
      ),
  ) as ObjectInfo;
  const missingNodes = requiredNodes.filter((node) => !info[node]);
  const missingAssets = choices(info, "RIFE_FPS_Resample", "ckpt_name").includes(H3_RIFE_TARGET_MODEL)
    ? []
    : [H3_RIFE_TARGET_MODEL];
  return {
    compatible: !missingNodes.length && !missingAssets.length,
    missingNodes,
    missingAssets,
    method: "RIFE_FPS_Resample",
  };
}

async function waitForRifeCompletion(args: {
  baseUrl: string;
  promptId: string;
  outputNodeId: string;
  timeoutMs?: number;
}) {
  const timeoutMs = args.timeoutMs ?? 30 * 60_000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const history = await getH3PromptHistoryFromBaseUrl(
      args.baseUrl,
      args.promptId,
      fetch,
      args.outputNodeId,
    );
    if (history.state === "completed" && history.video) return history.video;
    if (history.state === "failed") throw new Error("RIFE 60 FPS interpolation failed in ComfyUI.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Timed out waiting for RIFE 60 FPS interpolation to complete.");
}

export async function remuxH3RifeOriginalAudio(args: {
  videoPath: string;
  audioSourcePath: string;
  outputPath?: string;
}) {
  const videoPath = path.resolve(args.videoPath);
  const audioSourcePath = path.resolve(args.audioSourcePath);
  const parsed = path.parse(videoPath);
  const outputPath = path.resolve(
    args.outputPath
    || safeJoin(parsed.dir, `${parsed.name}-audio${parsed.ext || ".mp4"}`),
  );
  if (videoPath === outputPath || audioSourcePath === outputPath) {
    throw new Error("RIFE remux output path must not overwrite its inputs.");
  }
  const result = await runCmd(
    resolveFfmpegPath(),
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      videoPath,
      "-i",
      audioSourcePath,
      "-map",
      "0:v:0",
      "-map",
      "1:a?",
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { timeoutMs: 10 * 60_000 },
  );
  if (result.code !== 0 || !fs.existsSync(outputPath)) {
    throw new Error(`Could not preserve audio after RIFE interpolation: ${result.stderr || result.stdout || "ffmpeg failed"}`);
  }
  const stat = await fsp.stat(outputPath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error("RIFE audio-preserved output is missing or empty.");
  }
  return outputPath;
}

export async function applyH3Rife60FpsFinalization(args: {
  enabled: unknown;
  baseUrl?: string;
  backend?: ProductionV2H3BackendId;
  sourceVideoPath: string;
  ownerKey: string;
  productionId: string;
  sceneId: string;
  generationJobId: string;
  outputPrefix?: string;
  artifactSuffix?: string;
}) {
  if (!normalizeH3RifeInterpolation60Fps(args.enabled)) return null;
  const baseUrl = clean(args.baseUrl)
    || (args.backend ? H3_BACKEND_PROFILES[args.backend].baseUrl : "");
  if (!baseUrl) throw new Error(H3_RIFE_UNAVAILABLE_MESSAGE);

  const compatibility = await inspectH3Rife60FpsCompatibility(baseUrl);
  if (!compatibility.compatible) {
    throw new Error(
      `${H3_RIFE_UNAVAILABLE_MESSAGE} Missing nodes: ${compatibility.missingNodes.join(", ") || "none"}; missing assets: ${compatibility.missingAssets.join(", ") || "none"}.`,
    );
  }

  const uploadName = `${safeSegment(args.generationJobId)}_rife_source`;
  const uploaded = await uploadH3InputToBaseUrl({
    baseUrl,
    sourcePath: args.sourceVideoPath,
    mediaType: "video",
    uploadName,
  });
  const built = buildH3Rife60FpsWorkflow({
    videoFilename: uploaded,
    outputPrefix: args.outputPrefix || `otg_h3_rife/${safeSegment(args.generationJobId)}`,
  });
  const clientId = `otg-h3-rife-${crypto.randomUUID()}`;
  const submitted = await submitH3PromptToBaseUrl({
    baseUrl,
    graph: built.graph,
    clientId,
    jobId: `${args.generationJobId}-rife-60fps`,
    ownerKey: args.ownerKey,
    workerId: "h3-rife-60fps",
    preSubmitCleanup: null,
  });
  if (!submitted.accepted) {
    throw new Error(submitted.error || "ComfyUI rejected the RIFE 60 FPS workflow.");
  }
  const video = await waitForRifeCompletion({
    baseUrl,
    promptId: submitted.promptId,
    outputNodeId: built.outputNodeId,
  });
  const rawOutputPath = await downloadH3VideoFromBaseUrl({
    baseUrl,
    file: video,
    ownerKey: args.ownerKey,
    productionId: args.productionId,
    sceneId: args.sceneId,
    generationJobId: args.generationJobId,
    artifactSuffix: `${args.artifactSuffix || "rife-60fps"}-raw`,
  });
  const parsed = path.parse(rawOutputPath);
  const outputPath = await remuxH3RifeOriginalAudio({
    videoPath: rawOutputPath,
    audioSourcePath: args.sourceVideoPath,
    outputPath: safeJoin(parsed.dir, `${parsed.name.replace(/-raw$/, "")}-audio.mp4`),
  });
  return {
    enabled: true,
    nativeFps: H3_RIFE_NATIVE_FPS,
    finalFps: H3_RIFE_TARGET_FPS,
    promptId: submitted.promptId,
    workflowId: built.workflowId,
    workflowFile: built.workflowFile,
    rawOutputPath,
    outputPath,
  } satisfies H3Rife60FpsResult;
}
