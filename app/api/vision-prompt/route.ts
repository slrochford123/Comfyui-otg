// app/api/vision-prompt/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "module";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);

export const runtime = "nodejs";

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

async function fileToVisionBase64(filePath: string): Promise<{ b64: string; mime: string }> {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);

  if (ext === ".gif") {
    try {
      const sharp = require("sharp") as any;
      const pngBuf = await sharp(buf, { animated: true }).extractFrame(0).png().toBuffer();
      return { b64: pngBuf.toString("base64"), mime: "image/png" };
    } catch {
      throw new Error("GIF detected. Use PNG/JPG/WebP, or install 'sharp' to extract a frame.");
    }
  }

  let mime = "application/octet-stream";
  if (ext === ".png") mime = "image/png";
  else if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
  else if (ext === ".webp") mime = "image/webp";

  const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowed.has(mime)) {
    throw new Error(`Unsupported image format. Use PNG, JPG, or WebP (got: ${ext || "unknown"}).`);
  }

  return { b64: buf.toString("base64"), mime };
}

async function detectVisionModel(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { cache: "no-store" as any });
    if (!res.ok) return null;
    const data = await res.json();
    const models: string[] = data?.models?.map((m: any) => m?.name).filter(Boolean) ?? [];
    const preferred = models.find((m) => /vision|vl|qwen.*vl|llava/i.test(m));
    return preferred ?? (models[0] ?? null);
  } catch {
    return null;
  }
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
  pushPhrase(clothingParts, j?.outfit_top);
  pushPhrase(clothingParts, j?.outfit_bottom);
  pushPhrase(clothingParts, j?.outfit);
  pushPhrase(clothingParts, j?.footwear);
  pushPhrase(clothingParts, j?.armor);
  pushPhrase(clothingParts, j?.accessories);
  pushPhrase(clothingParts, j?.props);
  pushPhrase(clothingParts, j?.notable_features);

  const clothingAccessories = joinPhraseParts(clothingParts);

  return {
    clothingAccessories,
    surfaceDescription,
    hairFurColor: cleanDetailValue(j?.hair_fur_color ?? j?.hair_color ?? j?.fur_color ?? j?.hair),
    eyeColor: cleanDetailValue(j?.eye_color ?? j?.eyes),
  };
}

function isPathInside(root: string, target: string) {
  const rel = path.relative(root, target);
  return !(rel.startsWith("..") || path.isAbsolute(rel));
}

async function ollamaGenerate(baseUrl: string, model: string, prompt: string, b64: string) {
  const payload = {
    model,
    stream: false,
    prompt,
    images: [b64],
    options: {
      temperature: 0.2,
      top_p: 0.9,
      repeat_penalty: 1.15,
      num_predict: 256,
    },
  };

  const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false as const, status: r.status, body: text };
  }

  if (!r.ok) return { ok: false as const, status: r.status, body: json?.error || text };
  return { ok: true as const, output: (json?.response ?? "").toString() };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Request must be JSON" }, { status: 415 });
    }

    const { imagePath, promptHint, characterName, purpose } = body as any;
    if (!imagePath || typeof imagePath !== "string") {
      return NextResponse.json({ error: "Missing imagePath" }, { status: 400 });
    }

    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const storyboardRoot = path.resolve(path.join(dataRoot, "uploads", "storyboard"));
    const charactersUploadsRoot = path.resolve(path.join(dataRoot, "uploads", "characters"));
    const charactersLegacyRoot = path.resolve(path.join(dataRoot, "voices", "characters"));

    const resolved = path.resolve(imagePath);
    const allowed =
      isPathInside(storyboardRoot, resolved) ||
      isPathInside(charactersUploadsRoot, resolved) ||
      isPathInside(charactersLegacyRoot, resolved);

    if (!allowed) {
      return NextResponse.json(
        { error: "imagePath is outside allowed roots" },
        { status: 403 }
      );
    }

    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: `File not found: ${resolved}` }, { status: 404 });
    }

    const baseUrl =
      process.env.OLLAMA_BASE_URL || process.env.OTG_OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    const envModel = process.env.OLLAMA_VISION_MODEL;

    let model = envModel || "redule26/huihui_ai_qwen2.5-vl-7b-abliterated";
    const { b64 } = await fileToVisionBase64(resolved);

    const selectedPurpose = (purpose || "character").toString();
    const isBackground = selectedPurpose === "background";
    const isCharacterDetails = selectedPurpose === "character_details";

    const jsonSchema = isBackground
      ? `Return ONLY a single valid JSON object on ONE line with keys: {"location":"","time":"","lighting":"","objects":"","mood":""}. No markdown, no code fences, no extra text.`
      : isCharacterDetails
        ? `Return ONLY a single valid JSON object on ONE line with keys: {"surface_description":"","hair_fur_color":"","eye_color":"","outfit_top":"","outfit_bottom":"","footwear":"","armor":"","accessories":"","props":"","notable_features":""}. Use short natural phrases, not single-word token lists. If a field is not visible, return an empty string for that field. No markdown, no code fences, no extra text.`
        : `Return ONLY a single valid JSON object on ONE line with keys: {"gender":"","age_range":"","ethnicity":"","skin_tone":"","hair_style":"","hair_color":"","eye_color":"","outfit_top":"","outfit_bottom":"","footwear":"","accessories":"","build":"","notable_features":""}. No markdown, no code fences, no extra text.`;

    const hint = promptHint && typeof promptHint === "string" ? ` Hint: ${promptHint}` : "";
    const name =
      characterName && typeof characterName === "string" && characterName.trim()
        ? ` Character name: ${characterName.trim()}.`
        : "";

    const finalPrompt = isBackground
      ? `Describe ONLY the background/environment for AI video prompting. ${jsonSchema}${hint}`
      : isCharacterDetails
        ? `Describe ONLY visible character detail fields for a production character card. Focus on skin/fur/surface, hair/fur color, eye color, clothing, armor, footwear, accessories, props, colors, and materials. Write compact natural phrases such as "brown leather armor with gold accents" or "scaly green reptile skin"; do not return loose word lists. Do not infer story, personality, age, race, species, or gender.${name} ${jsonSchema}${hint}`
        : `Describe the single person for identity/face-lock prompting.${name} ${jsonSchema}${hint}`;

    let gen = await ollamaGenerate(baseUrl, model, finalPrompt, b64);
    if (!gen.ok && gen.status === 404) {
      const fallback = await detectVisionModel(baseUrl);
      if (fallback && fallback !== model) {
        model = fallback;
        gen = await ollamaGenerate(baseUrl, model, finalPrompt, b64);
      }
    }
    if (!gen.ok) {
      return NextResponse.json(
        { error: `OllamaVision request failed (${gen.status}): ${gen.body}` },
        { status: 500 }
      );
    }

    let parsed = tryParseJsonLoose(gen.output);

    if (!parsed) {
      const repairPrompt = isBackground
        ? `Rewrite the following into ONLY valid JSON (one line), keys: location,time,lighting,objects,mood. No markdown.\nTEXT:\n${gen.output}`
        : isCharacterDetails
          ? `Rewrite the following into ONLY valid JSON (one line), keys: surface_description,hair_fur_color,eye_color,outfit_top,outfit_bottom,footwear,armor,accessories,props,notable_features. No markdown.\nTEXT:\n${gen.output}`
          : `Rewrite the following into ONLY valid JSON (one line), keys: gender,age_range,ethnicity,skin_tone,hair_style,hair_color,eye_color,outfit_top,outfit_bottom,footwear,accessories,build,notable_features. No markdown.\nTEXT:\n${gen.output}`;

      let gen2 = await ollamaGenerate(baseUrl, model, repairPrompt, b64);
      if (!gen2.ok && gen2.status === 404) {
        const fallback = await detectVisionModel(baseUrl);
        if (fallback && fallback !== model) {
          model = fallback;
          gen2 = await ollamaGenerate(baseUrl, model, repairPrompt, b64);
        }
      }

      if (gen2.ok) parsed = tryParseJsonLoose(gen2.output);
    }

    let descriptor = "";
    let details: any = null;

    if (parsed) {
      if (isBackground) {
        descriptor = buildBackgroundFromJson(parsed);
      } else if (isCharacterDetails) {
        details = buildCharacterDetailsFromJson(parsed);
        descriptor = joinPhraseParts([
          details.surfaceDescription,
          details.hairFurColor ? `${details.hairFurColor} hair/fur color` : "",
          details.eyeColor ? `${details.eyeColor} eyes` : "",
          details.clothingAccessories,
        ]);
      } else {
        descriptor = buildDescriptorFromJson(parsed);
      }
    }

    if (!descriptor) descriptor = normalizeDescriptor(gen.output);
    if (!descriptor) {
      return NextResponse.json({ error: "Empty vision response" }, { status: 500 });
    }

    return NextResponse.json(details ? { descriptor, details } : { descriptor });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
