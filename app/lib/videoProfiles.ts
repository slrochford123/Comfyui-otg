export type RatioKey = "auto" | "landscape" | "portrait" | "square" | "cinematic" | "ultra";
export type SizeKey = "small" | "medium" | "large";

export type VideoProfileSelection = {
  ratio?: RatioKey;
  size?: SizeKey;
};

export type VideoProfileConstraints = {
  allowedRatios?: RatioKey[];
  allowedSizes?: SizeKey[];
  defaultRatio?: RatioKey;
  defaultSize?: SizeKey;
  lockRatio?: RatioKey; // if set, force this ratio
};

export type ResolvedVideoProfile = {
  ratio: RatioKey;
  size: SizeKey;
  width: number;
  height: number;
  isMobileDefault: boolean;
};

function norm(s: string) {
  return (s || "").toLowerCase();
}

/**
 * Auto ratio detection from prompt keywords.
 * Keep it simple + predictable: first match wins.
 */
export function detectRatioFromPrompt(prompt: string): Exclude<RatioKey, "auto"> {
  const p = norm(prompt);

  // Portrait / vertical / shorts
  if (/\b(vertical|portrait|9:16|tiktok|reels|shorts)\b/.test(p)) return "portrait";

  // Square
  if (/\b(square|1:1|instagram)\b/.test(p)) return "square";

  // Cinematic / anamorphic
  if (/\b(cinematic|film\s*look|movie\s*look|anamorphic|widescreen|2\.39|2\.4)\b/.test(p)) return "cinematic";

  // Ultra / high-res intent
  if (/\b(ultra|high\s*res|highres|4k|8k)\b/.test(p)) return "ultra";

  return "landscape";
}

type SizeTable = Record<SizeKey, { w: number; h: number }>;

const TABLE: Record<Exclude<RatioKey, "auto">, SizeTable> = {
  landscape: {
    small: { w: 384, h: 216 },
    medium: { w: 512, h: 288 },
    large: { w: 1280, h: 720 }, // 720p
  },
  portrait: {
    small: { w: 216, h: 384 },
    medium: { w: 288, h: 512 },
    large: { w: 720, h: 1280 }, // 720p (vertical)
  },
  square: {
    small: { w: 384, h: 384 },
    medium: { w: 512, h: 512 },
    large: { w: 720, h: 720 }, // "720p" square
  },
  cinematic: {
    // 2.39:1-ish (multiples of 8; close to 2.39)
    small: { w: 512, h: 216 },   // 2.370
    medium: { w: 768, h: 320 },  // 2.400
    large: { w: 1536, h: 640 },  // 2.400 (nice step-up)
  },
  ultra: {
    // Ultra tier (when WAN allows). Large matches your request.
    small: { w: 768, h: 432 },
    medium: { w: 1024, h: 576 },
    large: { w: 1536, h: 864 }, // requested
  },
};

function clampToAllowed<T extends string>(value: T, allowed?: T[]): T {
  if (!allowed || allowed.length === 0) return value;
  return (allowed.includes(value) ? value : allowed[0]) as T;
}

export function resolveVideoProfile(args: {
  selection?: VideoProfileSelection;
  constraints?: VideoProfileConstraints;
  positivePrompt?: string;
  userAgent?: string | null;
}): ResolvedVideoProfile {
  const ua = norm(args.userAgent || "");
  const isMobile = /\b(android|iphone|ipad|ipod|mobile)\b/.test(ua);

  const c = args.constraints || {};
  const sel = args.selection || {};

  // Locked ratio wins
  let ratio: RatioKey =
    c.lockRatio ||
    sel.ratio ||
    c.defaultRatio ||
    "auto";

  if (ratio === "auto") ratio = detectRatioFromPrompt(args.positivePrompt || "");

  // Default size: mobile -> medium, desktop -> large (unless explicitly set)
  let size: SizeKey = sel.size || c.defaultSize || (isMobile ? "medium" : "large");

  // Apply allowed lists
  ratio = clampToAllowed(ratio, c.allowedRatios);
  size = clampToAllowed(size, c.allowedSizes);

  // Cinematic is landscape-only. If user tries portrait + cinematic, force cinematic table (still landscape).
  const baseRatio = ratio === "auto" ? "landscape" : ratio;
  const dims = TABLE[(baseRatio as Exclude<RatioKey, "auto">)] || TABLE.landscape;
  const wh = dims[size];

  return {
    ratio: baseRatio,
    size,
    width: wh.w,
    height: wh.h,
    isMobileDefault: !sel.size && !c.defaultSize && isMobile,
  };
}

/**
 * Inject resolved width/height into a WAN latent video node.
 * Default nodeId is "236" for your current WAN graph.
 */
export function applyProfileToWanLatentNode(graph: any, resolved: ResolvedVideoProfile, nodeId = "236"): boolean {
  if (!graph || typeof graph !== "object") return false;
  const node = graph[nodeId];
  if (!node || typeof node !== "object") return false;
  if (!node.inputs || typeof node.inputs !== "object") return false;

  // Only set if the fields exist, to avoid breaking other graphs.
  if ("width" in node.inputs) node.inputs.width = resolved.width;
  if ("height" in node.inputs) node.inputs.height = resolved.height;
  return true;
}
