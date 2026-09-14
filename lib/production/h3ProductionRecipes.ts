export const H3_PRODUCTION_RECIPE_VERSION =
  "h3-lq-hq-sla-turbo8-2026-09-11-v1" as const;

export const H3_PRODUCTION_DURATION_OPTIONS = [5, 10] as const;
export const H3_QUALITY_OPTIONS = ["lq", "hq"] as const;
export const H3_ORIENTATION_OPTIONS = ["landscape", "portrait"] as const;
export const H3_NATIVE_RESOLUTIONS = {
  lq: { megapixels: 0.6, width: 1056, height: 608 },
  hq: { megapixels: 1.0, width: 1376, height: 768 },
} as const;

export type H3ProductionDuration =
  (typeof H3_PRODUCTION_DURATION_OPTIONS)[number];
export type H3Quality = (typeof H3_QUALITY_OPTIONS)[number];
export type H3Orientation = (typeof H3_ORIENTATION_OPTIONS)[number];
export type H3ProductionMode =
  | "h3-text-to-video"
  | "h3-image-to-video"
  | "h3-reference-to-video";
export type H3ProductionBackendId = "rtx5060ti" | "rtx3090";
export type H3TurboLoraFamily = "fl2v" | "r2v";

export type H3ProductionRecipe = {
  recipeId: string;
  routeKey: string;
  workflowFile: string;
  mode: H3ProductionMode;
  durationSeconds: H3ProductionDuration;
  backend: H3ProductionBackendId;
  quality: H3Quality;
  megapixels: 0.6 | 1.0;
  nativeWidth: 1056 | 1376;
  nativeHeight: 608 | 768;
  frameCount: 124 | 243;
  steps: 8;
  turboLoraFamily: H3TurboLoraFamily;
  turboLoraStrength: 1;
  spectrumEnabled: false;
  sampler: "euler";
  scheduler: "simple";
  videoSigmaShift: 6;
  audioSigmaShift: 3;
  fps: 24;
  nativeAudio: true;
  attentionPath: "sla";
  referenceImageSize: "match" | null;
  submissionCriticalSection: true;
  preSubmitCleanup: null;
  etaSeconds: number;
  finalWidth: 1920;
  finalHeight: 1080;
  finalization: "rtx-vsr-ultra";
  preserveNativeAudio: true;
  frameInterpolation: false;
};

type RouteSpec = readonly [
  H3ProductionBackendId,
  H3ProductionMode,
  H3ProductionDuration,
  H3Quality,
  number,
];

const ROUTE_SPECS: readonly RouteSpec[] = [
  ["rtx5060ti", "h3-text-to-video", 5, "lq", 113.756],
  ["rtx5060ti", "h3-text-to-video", 5, "hq", 436.559],
  ["rtx5060ti", "h3-text-to-video", 10, "lq", 270.4],
  ["rtx5060ti", "h3-text-to-video", 10, "hq", 985.805],
  ["rtx5060ti", "h3-image-to-video", 5, "lq", 95.409],
  ["rtx5060ti", "h3-image-to-video", 5, "hq", 153.127],
  ["rtx5060ti", "h3-image-to-video", 10, "lq", 188.215],
  ["rtx5060ti", "h3-image-to-video", 10, "hq", 984.087],
  ["rtx5060ti", "h3-reference-to-video", 5, "lq", 120.1],
  ["rtx5060ti", "h3-reference-to-video", 5, "hq", 555.569],
  ["rtx5060ti", "h3-reference-to-video", 10, "lq", 596.986],
  ["rtx5060ti", "h3-reference-to-video", 10, "hq", 680.282],
  ["rtx3090", "h3-text-to-video", 5, "lq", 119.64],
  ["rtx3090", "h3-text-to-video", 5, "hq", 188.619],
  ["rtx3090", "h3-text-to-video", 10, "lq", 226.19],
  ["rtx3090", "h3-text-to-video", 10, "hq", 393.923],
  ["rtx3090", "h3-image-to-video", 5, "lq", 122.396],
  ["rtx3090", "h3-image-to-video", 5, "hq", 189.68],
  ["rtx3090", "h3-image-to-video", 10, "lq", 237.433],
  ["rtx3090", "h3-image-to-video", 10, "hq", 404.465],
  ["rtx3090", "h3-reference-to-video", 5, "lq", 170],
  ["rtx3090", "h3-reference-to-video", 5, "hq", 453.001],
  ["rtx3090", "h3-reference-to-video", 10, "lq", 536.875],
  ["rtx3090", "h3-reference-to-video", 10, "hq", 940.042],
] as const;

function modeCode(mode: H3ProductionMode) {
  if (mode === "h3-text-to-video") return "T2V";
  if (mode === "h3-image-to-video") return "I2V";
  return "R2V";
}

export function h3ProductionRouteKey(
  backend: H3ProductionBackendId,
  mode: H3ProductionMode,
  durationSeconds: H3ProductionDuration,
  quality: H3Quality,
) {
  return `${backend}:${mode}:${durationSeconds}:${quality}`;
}

function recipe(spec: RouteSpec): H3ProductionRecipe {
  const [backend, mode, durationSeconds, quality, etaSeconds] = spec;
  const code = modeCode(mode);
  const routeKey = h3ProductionRouteKey(backend, mode, durationSeconds, quality);
  const hq = quality === "hq";

  return {
    recipeId: `h3-${backend}-${code.toLowerCase()}-${durationSeconds}s-${quality}-sla-turbo8-v1`,
    routeKey,
    workflowFile: `comfy_workflows/internal/production-v2/h3-lq-hq/${backend}_${code}_${durationSeconds}s_${quality.toUpperCase()}.api.json`,
    mode,
    durationSeconds,
    backend,
    quality,
    megapixels: H3_NATIVE_RESOLUTIONS[quality].megapixels,
    nativeWidth: H3_NATIVE_RESOLUTIONS[quality].width,
    nativeHeight: H3_NATIVE_RESOLUTIONS[quality].height,
    frameCount: durationSeconds === 10 ? 243 : 124,
    steps: 8,
    turboLoraFamily: mode === "h3-reference-to-video" ? "r2v" : "fl2v",
    turboLoraStrength: 1,
    spectrumEnabled: false,
    sampler: "euler",
    scheduler: "simple",
    videoSigmaShift: 6,
    audioSigmaShift: 3,
    fps: 24,
    nativeAudio: true,
    attentionPath: "sla",
    referenceImageSize: mode === "h3-reference-to-video" ? "match" : null,
    submissionCriticalSection: true,
    preSubmitCleanup: null,
    etaSeconds,
    finalWidth: 1920,
    finalHeight: 1080,
    finalization: "rtx-vsr-ultra",
    preserveNativeAudio: true,
    frameInterpolation: false,
  };
}

export const H3_PRODUCTION_RECIPES = Object.fromEntries(
  ROUTE_SPECS.map((spec) => {
    const value = recipe(spec);
    return [value.routeKey, value];
  }),
) as Record<string, H3ProductionRecipe>;

export const H3_PRODUCTION_ROUTE_KEYS = ROUTE_SPECS.map((spec) =>
  h3ProductionRouteKey(spec[0], spec[1], spec[2], spec[3]));

export function normalizeH3Quality(value: unknown): H3Quality {
  return value === "hq" ? "hq" : "lq";
}

export function normalizeH3Orientation(value: unknown): H3Orientation {
  return value === "portrait" ? "portrait" : "landscape";
}

export function getH3NativeDimensions(
  quality: H3Quality,
  orientation: H3Orientation,
) {
  const landscape = H3_NATIVE_RESOLUTIONS[quality];
  return orientation === "portrait"
    ? { width: landscape.height, height: landscape.width }
    : { width: landscape.width, height: landscape.height };
}

export function getH3ProductionRecipe(
  mode: H3ProductionMode,
  durationSeconds: H3ProductionDuration,
  backend: H3ProductionBackendId,
  quality: H3Quality,
): H3ProductionRecipe {
  const key = h3ProductionRouteKey(backend, mode, durationSeconds, quality);
  const selected = H3_PRODUCTION_RECIPES[key];
  if (!selected) {
    throw new Error(`No qualified MiniMax H3 workflow is registered for ${key}.`);
  }
  return selected;
}

export function getH3ProductionTimeEstimate(
  mode: H3ProductionMode,
  durationSeconds: H3ProductionDuration,
  quality: H3Quality,
  backend?: H3ProductionBackendId | null,
) {
  if (backend) {
    const seconds = getH3ProductionRecipe(
      mode,
      durationSeconds,
      backend,
      quality,
    ).etaSeconds;
    return { seconds, minSeconds: seconds, maxSeconds: seconds };
  }

  const values = (["rtx5060ti", "rtx3090"] as const).map((target) =>
    getH3ProductionRecipe(mode, durationSeconds, target, quality).etaSeconds);
  return {
    seconds: null,
    minSeconds: Math.min(...values),
    maxSeconds: Math.max(...values),
  };
}
