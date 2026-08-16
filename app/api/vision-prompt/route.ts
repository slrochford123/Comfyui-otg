// app/api/vision-prompt/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { QWEN_CLUSTER_MODEL, qwenClusterFetch } from "@/lib/workers/qwenClusterRouter";

const require = createRequire(import.meta.url);

export const runtime = "nodejs";

const DEFAULT_VISION_MAX_DIMENSION = 1024;
const DEFAULT_VISION_JPEG_QUALITY = 85;
const DEFAULT_VISION_NUM_CTX = 4096;
const DEFAULT_VISION_NUM_PREDICT = 160;
const DEFAULT_AUTO_DESCRIBE_TIMEOUT_MS = 23_000;
const DEFAULT_AUTO_DESCRIBE_MAX_IMAGE_DIM = 512;
const DEFAULT_AUTO_DESCRIBE_JPEG_QUALITY = 72;
const DEFAULT_AUTO_DESCRIBE_NUM_PREDICT = 120;
const DEFAULT_AUTO_DESCRIBE_NUM_CTX = 4096;
const DEFAULT_COMPLETE_DESCRIPTION_PROVIDER = "openai";
const DEFAULT_COMPLETE_DESCRIPTION_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_COMPLETE_DESCRIPTION_LOCAL_MODEL = "moondream:latest";
const DEFAULT_COMPLETE_DESCRIPTION_TIMEOUT_MS = 12_000;

function readPositiveIntEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const n = Number.parseInt((raw || "").trim(), 10);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function normalizeDescriptor(raw: string) {
  const s = (raw || "")
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .trim();

  const tokens = s
    .replace(/[|]/g, ",")
    .replace(/;+|\.+/g, ",")
    .replace(/\s*,\s*/g, ",")
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  const rebuilt = out.join(", ");
  if (out.length < 3) return s.slice(0, 340);
  return rebuilt.slice(0, 340);
}

function tryParseJsonLoose(text: string): any | null {
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let t = (fenced?.[1] ?? text).trim();

  t = t
    .replace(/^\uFEFF/, "")
    .replace(/^\s*,+/, "")
    .replace(/^json\s*/i, "")
    .trim();

  try {
    return JSON.parse(t);
  } catch {
    // continue
  }

  const oStart = t.indexOf("{");
  const oEnd = t.lastIndexOf("}");
  if (oStart !== -1 && oEnd !== -1 && oEnd > oStart) {
    const sub = t.slice(oStart, oEnd + 1);
    try {
      return JSON.parse(sub);
    } catch {
      // continue
    }
  }

  const aStart = t.indexOf("[");
  const aEnd = t.lastIndexOf("]");
  if (aStart !== -1 && aEnd !== -1 && aEnd > aStart) {
    const sub = t.slice(aStart, aEnd + 1);
    try {
      return JSON.parse(sub);
    } catch {
      // ignore
    }
  }

  return null;
}

function isLikelyRepeatedTokenGarbage(text: string) {
  const compact = (text || "").replace(/\s+/g, "").trim();
  if (compact.length < 24) return false;

  if (/^@\@{23,}$/.test(compact)) return true;
  if (/^0{24,}$/.test(compact)) return true;

  const chars = compact.slice(0, 256).split("");
  const counts = new Map<string, number>();
  for (const ch of chars) counts.set(ch, (counts.get(ch) || 0) + 1);

  const mostCommon = Math.max(...Array.from(counts.values()));
  const repeatedRatio = mostCommon / chars.length;
  const unique = counts.size;

  if (unique <= 2 && repeatedRatio >= 0.9 && /[@0]/.test(compact)) return true;
  return false;
}

type VisionImagePayload = {
  b64: string;
  mime: string;
  width?: number;
  height?: number;
  bytes: number;
};

async function resizeForOllamaVision(buf: Buffer, sourceLabel: string): Promise<VisionImagePayload> {
  const sharp = require("sharp") as any;

  const maxDimension = readPositiveIntEnv(
    "OTG_VISION_IMAGE_MAX_DIMENSION",
    DEFAULT_VISION_MAX_DIMENSION,
    256,
    4096
  );
  const jpegQuality = readPositiveIntEnv(
    "OTG_VISION_JPEG_QUALITY",
    DEFAULT_VISION_JPEG_QUALITY,
    40,
    95
  );

  try {
    const out = await sharp(buf, { failOn: "none", limitInputPixels: false })
      .rotate()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toBuffer();

    const metadata = await sharp(out, { failOn: "none" }).metadata();
    return { b64: out.toString("base64"), mime: "image/jpeg", width: metadata.width, height: metadata.height, bytes: out.length };
  } catch (e: any) {
    throw new Error(`Failed to prepare image for Ollama vision (${sourceLabel}): ${e?.message || String(e)}`);
  }
}

async function resizeForAutoDescribe(buf: Buffer, sourceLabel: string): Promise<VisionImagePayload> {
  const sharp = require("sharp") as any;
  const maxDimension = readPositiveIntEnv(
    "OTG_AUTO_DESCRIBE_MAX_IMAGE_DIM",
    DEFAULT_AUTO_DESCRIBE_MAX_IMAGE_DIM,
    256,
    1024
  );
  const jpegQuality = readPositiveIntEnv(
    "OTG_AUTO_DESCRIBE_JPEG_QUALITY",
    DEFAULT_AUTO_DESCRIBE_JPEG_QUALITY,
    50,
    85
  );

  try {
    const out = await sharp(buf, { failOn: "none", limitInputPixels: false })
      .rotate()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: { r: 245, g: 245, b: 245 } })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toBuffer();

    const metadata = await sharp(out, { failOn: "none" }).metadata();
    return { b64: out.toString("base64"), mime: "image/jpeg", width: metadata.width, height: metadata.height, bytes: out.length };
  } catch (e: any) {
    throw new Error(`Failed to prepare Auto Describe image (${sourceLabel}): ${e?.message || String(e)}`);
  }
}

async function fileToVisionBase64(filePath: string, options: { autoDescribe?: boolean } = {}): Promise<VisionImagePayload> {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);

  let mime = "application/octet-stream";
  if (ext === ".png") mime = "image/png";
  else if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
  else if (ext === ".webp") mime = "image/webp";
  else if (ext === ".gif") mime = "image/gif";

  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  if (!allowed.has(mime)) {
    throw new Error(`Unsupported image format. Use PNG, JPG, WebP, or GIF (got: ${ext || "unknown"}).`);
  }

  if (ext === ".gif") {
    try {
      const sharp = require("sharp") as any;
      let pipeline = sharp(buf, { animated: true, limitInputPixels: false });
      if (typeof pipeline.extractFrame === "function") {
        pipeline = pipeline.extractFrame(0);
      }
      const firstFrame = await pipeline.png().toBuffer();
      return options.autoDescribe
        ? resizeForAutoDescribe(firstFrame, "gif first frame")
        : resizeForOllamaVision(firstFrame, "gif first frame");
    } catch (e: any) {
      throw new Error(`GIF detected but the first frame could not be extracted: ${e?.message || String(e)}`);
    }
  }

  return options.autoDescribe ? resizeForAutoDescribe(buf, ext || "image") : resizeForOllamaVision(buf, ext || "image");
}

function buildDescriptorFromJson(j: any) {
  const raw: string[] = [];
  const push = (s?: string) => {
    const v = (s ?? "").toString().replace(/\s+/g, " ").trim();
    if (v) raw.push(v);
  };

  push(j?.gender);
  push(j?.age_range ?? j?.age);
  push(j?.ethnicity);
  push(j?.skin_tone ?? j?.skin);
  push(j?.hair_style);
  push(j?.hair_color);
  push(j?.hair);
  push(j?.eye_color);
  push(j?.eyes);
  push(j?.outfit_top);
  push(j?.outfit_bottom);
  push(j?.outfit);
  push(j?.footwear);
  push(j?.accessories);
  push(j?.build);
  push(j?.notable_features);

  const joined = raw.join(", ");
  const norm = normalizeDescriptor(joined);
  const tokens = norm.split(/\s*,\s*/).filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const k = t.toLowerCase();
    if ((k === "female" || k === "male") && seen.has(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join(", ").slice(0, 340);
}

function buildBackgroundFromJson(j: any) {
  const parts: string[] = [];
  const push = (s?: string) => {
    const v = (s ?? "").toString().trim();
    if (v) parts.push(v);
  };
  push(j?.location);
  push(j?.time);
  push(j?.lighting);
  push(j?.objects);
  push(j?.mood);
  return normalizeDescriptor(parts.join(", "));
}

function cleanDetailValue(value: any) {
  return (value ?? "")
    .toString()
    .replace(/\s+/g, " ")
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .trim()
    .slice(0, 420);
}

function cleanProviderName(value: any) {
  return (value ?? "").toString().trim().toLowerCase();
}

function summarizeManualDetails(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const labels: Array<[string, string]> = [
    ["name", "name"],
    ["age", "age"],
    ["species", "species"],
    ["gender", "gender"],
    ["height", "height"],
    ["build", "build"],
    ["clothingAccessories", "existing clothing/accessories field"],
    ["surfaceDescription", "surface field"],
    ["hairFurColor", "hair/fur color"],
    ["eyeColor", "eye color"],
  ];
  const lines: string[] = [];
  for (const [key, label] of labels) {
    const v = cleanDetailValue(value[key]);
    if (!isEmptyVisionValue(v)) lines.push(`${label}: ${v}`);
  }
  return lines.join("; ").slice(0, 900);
}

function hasCompleteDescriptionShape(parsed: any) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  if (typeof parsed.descriptor !== "string") return false;
  if (!parsed.details || typeof parsed.details !== "object" || Array.isArray(parsed.details)) return false;
  return ["clothingAccessories", "surfaceDescription", "hairFurColor", "eyeColor"].every(
    (key) => typeof parsed.details[key] === "string"
  );
}

function isEmptyVisionValue(value: string) {
  const v = cleanDetailValue(value).toLowerCase();
  return !v || ["none", "no", "n/a", "na", "null", "undefined", "unknown", "not applicable"].includes(v);
}

function pushPhrase(parts: string[], value: any) {
  const v = cleanDetailValue(value);
  if (!isEmptyVisionValue(v)) parts.push(v);
}

function joinPhraseParts(parts: string[]) {
  const seen = new Set<string>();
  const cleaned = parts
    .map(cleanDetailValue)
    .filter((part) => !isEmptyVisionValue(part))
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return cleaned
    .join(", ")
    .replace(/\bwith,\s*/gi, "with ")
    .replace(/,\s*and,\s*/gi, ", ")
    .replace(/,\s*,+/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/^,\s*|,\s*$/g, "")
    .trim()
    .slice(0, 520);
}

function buildCharacterDetailsFromJson(j: any) {
  const surfaceParts: string[] = [];
  pushPhrase(surfaceParts, j?.surface_description);
  pushPhrase(surfaceParts, j?.skin_fur_surface);
  pushPhrase(surfaceParts, j?.skin_tone);
  pushPhrase(surfaceParts, j?.skin);
  const surfaceDescription = joinPhraseParts(surfaceParts);

  const clothingParts: string[] = [];
  pushPhrase(clothingParts, j?.clothingAccessories);
  pushPhrase(clothingParts, j?.clothing_accessories);
  pushPhrase(clothingParts, j?.outfit_top);
  pushPhrase(clothingParts, j?.outfit_bottom);
  pushPhrase(clothingParts, j?.outfit);
  pushPhrase(clothingParts, j?.footwear);
  pushPhrase(clothingParts, j?.armor);
  pushPhrase(clothingParts, j?.accessories);
  pushPhrase(clothingParts, j?.props);

  const clothingAccessories = joinPhraseParts(clothingParts);

  const extra: Record<string, string> = {};
  const characterType = cleanDetailValue(j?.characterType ?? j?.character_type);
  const bodyForm = cleanDetailValue(j?.bodyForm ?? j?.body_form);
  const lowerBodyLocomotion = cleanDetailValue(j?.lowerBodyLocomotion ?? j?.lower_body_locomotion);
  const distinctFeatures = cleanDetailValue(j?.distinctiveFeatures ?? j?.distinctive_features ?? j?.distinctFeatures ?? j?.distinct_features ?? j?.notable_features);
  if (!isEmptyVisionValue(characterType)) extra.characterType = characterType;
  if (!isEmptyVisionValue(bodyForm)) extra.bodyForm = bodyForm;
  if (!isEmptyVisionValue(lowerBodyLocomotion)) extra.lowerBodyLocomotion = lowerBodyLocomotion;
  if (!isEmptyVisionValue(distinctFeatures)) extra.distinctFeatures = distinctFeatures;

  return {
    clothingAccessories,
    surfaceDescription,
    hairFurColor: cleanDetailValue(j?.hair_fur_color ?? j?.hair_color ?? j?.fur_color ?? j?.hair),
    eyeColor: cleanDetailValue(j?.eye_color ?? j?.eyes),
    ...extra,
  };
}

function isPathInside(root: string, target: string) {
  const rel = path.relative(root, target);
  return !(rel.startsWith("..") || path.isAbsolute(rel));
}

type NormalizedVisionImagePath = {
  ok: true;
  resolved: string;
  normalizedKind: "local_path" | "api_file_url" | "relative_path";
  matchedRoot: string;
} | {
  ok: false;
  normalizedKind: "local_path" | "api_file_url" | "relative_path" | "remote_url" | "browser_url" | "data_url" | "invalid";
  reason: string;
};

function normalizeVisionImagePath(rawImagePath: string, dataRootRaw: string): NormalizedVisionImagePath {
  const raw = String(rawImagePath || "").trim();
  if (!raw) return { ok: false, normalizedKind: "invalid", reason: "empty imagePath" };

  if (/^https?:\/\//i.test(raw)) {
    return { ok: false, normalizedKind: "remote_url", reason: "remote URLs are not allowed" };
  }
  if (/^blob:/i.test(raw)) {
    return { ok: false, normalizedKind: "browser_url", reason: "browser blob URLs are not readable by the server" };
  }
  if (/^data:/i.test(raw)) {
    return { ok: false, normalizedKind: "data_url", reason: "data URLs are not accepted for Complete Description" };
  }

  const dataRoot = path.resolve(dataRootRaw);
  const allowedRoots = [
    dataRoot,
    path.resolve(path.join(dataRoot, "uploads")),
    path.resolve(path.join(dataRoot, "characters")),
    path.resolve(path.join(dataRoot, "tmp")),
    path.resolve(path.join(dataRoot, "voices", "characters")),
  ];

  let normalizedKind: NormalizedVisionImagePath["normalizedKind"] = "local_path";
  let candidate = raw;

  if (raw.startsWith("/api/file")) {
    normalizedKind = "api_file_url";
    try {
      const parsed = new URL(raw, "http://127.0.0.1");
      candidate = parsed.searchParams.get("path") || "";
    } catch {
      return { ok: false, normalizedKind, reason: "invalid /api/file URL" };
    }
  } else if (!path.isAbsolute(raw)) {
    normalizedKind = "relative_path";
    const normalizedRaw = raw.replace(/\\/g, "/").replace(/^\/+/, "");
    candidate = normalizedRaw === "data" || normalizedRaw.startsWith("data/")
      ? path.resolve(process.cwd(), normalizedRaw)
      : path.resolve(dataRoot, normalizedRaw);
  }

  if (!candidate) return { ok: false, normalizedKind, reason: "missing image path" };

  const resolved = path.resolve(candidate);
  const matchedRoot = allowedRoots.find((root) => isPathInside(root, resolved));
  if (!matchedRoot) {
    return { ok: false, normalizedKind, reason: "outside allowed project data roots" };
  }

  return { ok: true, resolved, normalizedKind, matchedRoot };
}

async function ollamaGenerate(
  prompt: string,
  b64: string,
  timeoutMs: number,
  options: { autoDescribe?: boolean } = {},
) {
  const numCtx = options.autoDescribe
    ? readPositiveIntEnv("OTG_AUTO_DESCRIBE_NUM_CTX", DEFAULT_AUTO_DESCRIBE_NUM_CTX, 2048, 8192)
    : readPositiveIntEnv("OTG_VISION_NUM_CTX", DEFAULT_VISION_NUM_CTX, 1024, 8192);
  const numPredict = options.autoDescribe
    ? readPositiveIntEnv("OTG_AUTO_DESCRIBE_NUM_PREDICT", DEFAULT_AUTO_DESCRIBE_NUM_PREDICT, 80, 180)
    : readPositiveIntEnv("OTG_VISION_NUM_PREDICT", DEFAULT_VISION_NUM_PREDICT, 64, 180);
  const payload = {
    model: QWEN_CLUSTER_MODEL,
    stream: false,
    prompt,
    images: [b64],
    options: {
      temperature: 0.1,
      repeat_penalty: 1.15,
      num_ctx: numCtx,
      num_predict: numPredict,
    },
  };

  let r: Response;
  try {
    r = await qwenClusterFetch("/api/generate", payload, { requiredContextTokens: numCtx, timeoutMs });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      return {
        ok: false as const,
        status: 504,
        body: "Auto Describe timed out. Try again or use a smaller/final selected character image.",
      };
    }
    return { ok: false as const, status: 502, body: error?.message || String(error) };
  }

  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false as const, status: r.status, body: text };
  }

  if (!r.ok) return { ok: false as const, status: r.status, body: json?.error || text };

  const output = (json?.response ?? "").toString();
  if (isLikelyRepeatedTokenGarbage(output)) {
    return {
      ok: false as const,
      status: 502,
      body: "OllamaVision returned repeated-token garbage output after image preprocessing. Fill the character fields manually or switch to a stable vision model.",
    };
  }

  return { ok: true as const, output };
}

async function openaiVisionGenerate(
  model: string,
  prompt: string,
  image: VisionImagePayload,
  timeoutMs: number,
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false as const, status: 401, body: "OPENAI_API_KEY is not configured." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${image.mime};base64,${image.b64}`,
                  detail: "low",
                },
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // handled below
    }

    if (!r.ok) {
      return { ok: false as const, status: r.status, body: json?.error?.message || text };
    }

    const output = (json?.choices?.[0]?.message?.content ?? "").toString();
    if (!output.trim()) return { ok: false as const, status: 502, body: "OpenAI returned an empty response." };
    return { ok: true as const, output, elapsedMs: Date.now() - startedAt };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      return {
        ok: false as const,
        status: 504,
        body: "Complete Description timed out.",
      };
    }
    return { ok: false as const, status: 502, body: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Request must be JSON" }, { status: 415 });
    }

    const { imagePath, promptHint, characterName, purpose, characterAnatomyMode, manualDetails } = body as any;
    if (!imagePath || typeof imagePath !== "string") {
      return NextResponse.json({ error: "Missing imagePath" }, { status: 400 });
    }

    const selectedPurpose = (purpose || "character").toString();
    const isCharacterDetails = selectedPurpose === "character_details";
    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const normalizedImagePath = normalizeVisionImagePath(imagePath, dataRoot);

    if (!normalizedImagePath.ok) {
      if (isCharacterDetails) {
        console.warn("[CompleteDescription] image_path_rejected", {
          normalizedKind: normalizedImagePath.normalizedKind,
          reason: normalizedImagePath.reason,
        });
      }
      return NextResponse.json(
        {
          error: "Complete Description image is not readable from an allowed project data folder.",
          reason: normalizedImagePath.reason,
          normalizedKind: normalizedImagePath.normalizedKind,
        },
        { status: 403 }
      );
    }

    const resolved = normalizedImagePath.resolved;
    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: `File not found: ${resolved}` }, { status: 404 });
    }

    if (isCharacterDetails) {
      console.info("[CompleteDescription] image_path_resolved", {
        normalizedKind: normalizedImagePath.normalizedKind,
        resolved,
        matchedRoot: normalizedImagePath.matchedRoot,
      });
    }

    const isBackground = selectedPurpose === "background";
    const isFreeformCharacter = String(characterAnatomyMode || "").toLowerCase() === "freeform";
    const completeDescriptionProvider = cleanProviderName(
      process.env.OTG_COMPLETE_DESCRIPTION_PROVIDER || DEFAULT_COMPLETE_DESCRIPTION_PROVIDER
    );
    const completeDescriptionOpenAiModel =
      process.env.OTG_COMPLETE_DESCRIPTION_OPENAI_MODEL || DEFAULT_COMPLETE_DESCRIPTION_OPENAI_MODEL;
    const completeDescriptionLocalModel =
      process.env.OTG_COMPLETE_DESCRIPTION_LOCAL_MODEL || DEFAULT_COMPLETE_DESCRIPTION_LOCAL_MODEL;
    const model = QWEN_CLUSTER_MODEL;
    const visionImage = await fileToVisionBase64(resolved, { autoDescribe: isCharacterDetails });
    const { b64 } = visionImage;
    const autoDescribeTimeoutMs = readPositiveIntEnv(
      "OTG_AUTO_DESCRIBE_TIMEOUT_MS",
      DEFAULT_AUTO_DESCRIBE_TIMEOUT_MS,
      8_000,
      25_000
    );
    const completeDescriptionTimeoutMs = readPositiveIntEnv(
      "OTG_COMPLETE_DESCRIPTION_TIMEOUT_MS",
      DEFAULT_COMPLETE_DESCRIPTION_TIMEOUT_MS,
      5_000,
      25_000
    );

    const jsonSchema = isBackground
      ? `Return ONLY a single valid JSON object on ONE line with keys: {"location":"","time":"","lighting":"","objects":"","mood":""}. No markdown, no code fences, no extra text.`
      : isCharacterDetails
        ? `{"descriptor":"","details":{"clothingAccessories":"","surfaceDescription":"","hairFurColor":"","eyeColor":"","characterType":"","bodyForm":"","lowerBodyLocomotion":"","distinctiveFeatures":""}}`
        : `Return ONLY a single valid JSON object on ONE line with keys: {"gender":"","age_range":"","ethnicity":"","skin_tone":"","hair_style":"","hair_color":"","eye_color":"","outfit_top":"","outfit_bottom":"","footwear":"","accessories":"","build":"","notable_features":""}. No markdown, no code fences, no extra text.`;

    const hint = promptHint && typeof promptHint === "string" ? ` Hint: ${promptHint}` : "";
    const name =
      characterName && typeof characterName === "string" && characterName.trim()
        ? ` Character name: ${characterName.trim()}.`
        : "";
    const manualSummary = summarizeManualDetails(manualDetails);
    const manualBlock = manualSummary ? ` Manual details: ${manualSummary}.` : "";

    const finalPrompt = isBackground
      ? `Describe ONLY the background/environment for AI video prompting. ${jsonSchema}${hint}`
      : isCharacterDetails
        ? [
            "OTG_COMPLETE_DESCRIPTION_CLOTHING_EXTRACTION",
            "Return compact JSON only.",
            "Treat character sheets or multi-view images as one character reference.",
            "Extract persistent visible character identity details from the image.",
            "For clothingAccessories, list only concrete visible outfit/accessory items by type and color.",
            "For standard humanoid characters, include visible hat, coat, jacket, shirt, tie, vest, gloves, belt, pants, trousers, boots, shoes, jewelry, bags, weapons, props, or similar items.",
            "Do not put name, species, gender, height, build, pose, expression, anatomy, or personality into clothingAccessories.",
            "If clothing is visible on a standard humanoid character, clothingAccessories must not be blank.",
            "Manual fields are authoritative, but visible clothing/accessory extraction should come from the image unless the manual clothing field clearly lists clothing items.",
            isFreeformCharacter
              ? "For freeform characters, preserve natural anatomy. clothingAccessories may be blank when no clothing/accessories are visible; put anatomy/features in distinctiveFeatures. Do not force humanoid anatomy."
              : "",
            `Required JSON shape: ${jsonSchema}`,
            name.trim(),
            manualBlock.trim(),
            hint.trim(),
            "Do not return markdown.",
          ].filter(Boolean).join(" ")
        : `Describe the single person for identity/face-lock prompting.${name} ${jsonSchema}${hint}`;

    let providerOutput = "";
    let parsed: any = null;

    if (isCharacterDetails) {
      console.info("[CompleteDescription] request", {
        provider: completeDescriptionProvider,
        openaiModel: completeDescriptionOpenAiModel,
        localModel: completeDescriptionLocalModel,
        imagePath: resolved,
        width: visionImage.width,
        height: visionImage.height,
        bytes: visionImage.bytes,
        timeoutMs: completeDescriptionTimeoutMs,
      });

      if (["disabled", "manual", "none", "off"].includes(completeDescriptionProvider)) {
        return NextResponse.json(
          { error: "Complete Description provider is disabled. Use manual details or enable a provider." },
          { status: 400 }
        );
      }

      const attempts: Array<"openai" | "ollama"> =
        completeDescriptionProvider === "ollama"
          ? ["ollama"]
          : completeDescriptionProvider === "openai" && process.env.OPENAI_API_KEY
            ? ["openai", "ollama"]
            : ["ollama"];

      let lastFailure = "";
      let usedProvider = "";
      let fallbackUsed = false;
      const routeStartedAt = Date.now();

      for (const provider of attempts) {
        const attemptStartedAt = Date.now();
        console.info("[CompleteDescription] provider_attempt", {
          provider,
          model: provider === "openai" ? completeDescriptionOpenAiModel : model,
          timeoutMs: completeDescriptionTimeoutMs,
        });

        let result:
          | Awaited<ReturnType<typeof openaiVisionGenerate>>
          | Awaited<ReturnType<typeof ollamaGenerate>>;

        if (provider === "openai") {
          result = await openaiVisionGenerate(
            completeDescriptionOpenAiModel,
            finalPrompt,
            visionImage,
            completeDescriptionTimeoutMs
          );
        } else {
          result = await ollamaGenerate(finalPrompt, b64, completeDescriptionTimeoutMs, {
            autoDescribe: true,
          });
        }

        console.info("[CompleteDescription] provider_response", {
          provider,
          model: provider === "openai" ? completeDescriptionOpenAiModel : model,
          elapsedMs: Date.now() - attemptStartedAt,
          ok: result.ok,
          status: result.ok ? 200 : result.status,
        });

        if (!result.ok) {
          lastFailure = `${provider} failed (${result.status}): ${result.body}`;
          console.warn("[CompleteDescription] provider_failed", {
            provider,
            status: result.status,
            message: result.body,
          });
          continue;
        }

        const candidate = tryParseJsonLoose(result.output);
        if (!hasCompleteDescriptionShape(candidate)) {
          lastFailure = `${provider} returned invalid Complete Description JSON`;
          console.warn("[CompleteDescription] invalid_json", { provider, elapsedMs: Date.now() - attemptStartedAt });
          continue;
        }

        providerOutput = result.output;
        parsed = candidate;
        usedProvider = provider;
        fallbackUsed = provider === "ollama" && attempts[0] === "openai";
        break;
      }

      console.info("[CompleteDescription] complete", {
        provider: usedProvider || "none",
        fallbackUsed,
        elapsedMs: Date.now() - routeStartedAt,
        timeoutMs: completeDescriptionTimeoutMs,
        ok: Boolean(parsed),
      });

      if (!parsed) {
        console.warn("[CompleteDescription] failed", { message: lastFailure });
        return NextResponse.json(
          { error: "Complete Description failed. Check provider settings or use manual details." },
          { status: 502 }
        );
      }
    } else {
      const startedAt = Date.now();
      const gen = await ollamaGenerate(finalPrompt, b64, autoDescribeTimeoutMs);
      if (!gen.ok) {
        return NextResponse.json(
          { error: `OllamaVision request failed (${gen.status}): ${gen.body}` },
          { status: 500 }
        );
      }

      providerOutput = gen.output;
      parsed = tryParseJsonLoose(gen.output);

      if (!parsed) {
      const repairPrompt = isBackground
        ? `Rewrite the following into ONLY valid JSON (one line), keys: location,time,lighting,objects,mood. No markdown.\nTEXT:\n${gen.output}`
        : `Rewrite the following into ONLY valid JSON (one line), keys: gender,age_range,ethnicity,skin_tone,hair_style,hair_color,eye_color,outfit_top,outfit_bottom,footwear,accessories,build,notable_features. No markdown.\nTEXT:\n${gen.output}`;

      const gen2 = await ollamaGenerate(repairPrompt, b64, autoDescribeTimeoutMs);

      if (gen2.ok) parsed = tryParseJsonLoose(gen2.output);
      }

      console.info("[VisionPrompt] response", {
        model,
        purpose: selectedPurpose,
        elapsedMs: Date.now() - startedAt,
        timeoutMs: autoDescribeTimeoutMs,
        ok: Boolean(parsed),
      });
    }

    let descriptor = "";
    let details: any = null;

    if (parsed) {
      if (isBackground) {
        descriptor = buildBackgroundFromJson(parsed);
      } else if (isCharacterDetails) {
        const source = parsed?.details && typeof parsed.details === "object" ? parsed.details : parsed;
        details = buildCharacterDetailsFromJson(source);
        descriptor = joinPhraseParts([
          cleanDetailValue(parsed?.descriptor),
          details.surfaceDescription,
          details.hairFurColor ? `${details.hairFurColor} hair/fur color` : "",
          details.eyeColor ? `${details.eyeColor} eyes` : "",
          details.clothingAccessories,
          details.characterType,
          details.bodyForm,
          details.lowerBodyLocomotion,
          details.distinctFeatures,
        ]);
      } else {
        descriptor = buildDescriptorFromJson(parsed);
      }
    }

    if (!descriptor) descriptor = normalizeDescriptor(providerOutput);

    if (isLikelyRepeatedTokenGarbage(descriptor)) {
      return NextResponse.json(
        {
          error:
            "OllamaVision returned unusable repeated-token output. Fill the character fields manually or switch to a stable vision model.",
        },
        { status: 500 }
      );
    }

    if (!descriptor) {
      return NextResponse.json({ error: "Empty vision response" }, { status: 500 });
    }

    return NextResponse.json(details ? { descriptor, details } : { descriptor });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}



