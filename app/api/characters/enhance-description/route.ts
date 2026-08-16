import { NextRequest, NextResponse } from "next/server";
import { getOwnerContext } from "@/lib/ownerKey";
import { QWEN_CLUSTER_MODEL, qwenClusterFetch } from "@/lib/workers/qwenClusterRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Legacy OLLAMA_CHARACTER_DESCRIPTION_URL and OLLAMA_BASE_URL configuration
// names remain documented for compatibility; endpoint selection now belongs
// exclusively to qwenClusterFetch so routes cannot bypass GPU arbitration.

const DEFAULT_CHARACTER_TIMEOUT_MS = 45_000;
const MAX_CHARACTER_TIMEOUT_MS = 60_000;

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function enhancerModel() {
  return (
    cleanText(
      process.env.OLLAMA_CHARACTER_DESCRIPTION_MODEL ||
        "qwen2.5:3b",
    ) || "qwen2.5:3b"
  );
}

function characterDescriptionTimeoutMs() {
  const configured = Number(
    process.env.OLLAMA_CHARACTER_DESCRIPTION_TIMEOUT_MS ||
      DEFAULT_CHARACTER_TIMEOUT_MS,
  );

  if (!Number.isFinite(configured)) {
    return DEFAULT_CHARACTER_TIMEOUT_MS;
  }

  return Math.max(
    3_000,
    Math.min(MAX_CHARACTER_TIMEOUT_MS, configured),
  );
}

function characterDescriptionInstruction() {
  return [
    "You are a character-description writer.",
    "Expand the user's short character concept into one specific, vivid, generation-ready description.",
    "Preserve every explicit fact the user supplied. Do not change the character's identity, species, age, gender presentation, role, or named traits.",
    "Preserve the user's basic body plan and number or arrangement of limbs, heads, eyes, and other major anatomy unless the user explicitly requested a change.",
    "Add about 5-8 plausible concrete visual details where the user left them unspecified.",
    "Describe what the character actually looks like rather than listing categories of detail.",
    "Use specific physical traits, facial details, hair/fur/foliage/surface qualities, eye appearance, body build when relevant, clothing pieces, garment construction, materials, colors, accessories, textures, markings, wear, and distinctive identifying features.",
    "Make all added details coherent with the original concept.",
    "For fantasy, mutant, robotic, creature, or non-human characters, develop the unusual biological or material features in concrete visual terms.",
    "Do not invent powers, transformations, seasonal transformations, lore, backstory, personality, or story behavior.",
    "Do not use vague filler such as 'clearly defined features', 'surface details', 'clothing construction', 'materials and colors', 'character-specific details', or 'consistent with the original concept'.",
    "Do not describe categories you could add. Actually choose appropriate details and describe them.",
    "Do not add an art style, rendering style, medium, quality tag, camera, lens, lighting, background, environment, composition, framing, crop instruction, pose instruction, anatomy rule, or image-generation command.",
    "Do not add unrelated story events, scenery, additional characters, or actions.",
    "Do not sexualize a character described as a child or teenager.",
    "Write one natural paragraph around 60-90 words.",
    "Return only the finished enhanced character description. No heading, bullet list, labels, explanation, quotation marks, or preamble.",
  ].join("\n");
}

function refinementInstruction() {
  return [
    "Rewrite the draft into a stronger character description.",
    "Keep the original user's facts unchanged.",
    "Preserve the user's basic body plan; do not invent powers, transformations, seasonal transformations, lore, backstory, personality, or story behavior.",
    "Replace generic category language with concrete visual choices.",
    "Include about 5-8 concrete visual additions and keep the result around 60-90 words.",
    "The result must describe what the character looks like, not explain what details should be added.",
    "Do not add art style, camera, lighting, background, environment, framing, composition, pose, crop, anatomy rules, or quality tags.",
    "Return one natural paragraph only.",
  ].join("\n");
}

function looksGeneric(value: string) {
  const normalized = value.toLowerCase();

  const genericPhrases = [
    "clearly defined facial",
    "identifying features",
    "hair or surface details",
    "clothing construction",
    "materials, colors",
    "accessories, textures",
    "character-specific details",
    "consistent with the original concept",
    "add details",
    "include details",
  ];

  const matches = genericPhrases.filter((phrase) =>
    normalized.includes(phrase),
  ).length;

  const words = normalized
    .split(/\s+/)
    .filter(Boolean);

  return words.length < 45 || matches >= 2;
}

async function generateWithOllama(args: {
  instruction: string;
  original: string;
  draft?: string;
}) {
  const timeoutMs = characterDescriptionTimeoutMs();
  {
    const promptParts = [
      args.instruction,
      "",
      "Original character concept:",
      args.original,
    ];

    if (args.draft) {
      promptParts.push(
        "",
        "Draft to improve:",
        args.draft,
      );
    }

    promptParts.push(
      "",
      "Final enhanced character description only:",
    );

    const response = await qwenClusterFetch(
      "/api/generate",
        {
          model: QWEN_CLUSTER_MODEL,
          stream: false,
          keep_alive:
            process.env.OLLAMA_CHARACTER_DESCRIPTION_KEEP_ALIVE ||
            "5m",
          prompt: promptParts.join("\n"),
          options: {
            temperature: 0.45,
            top_p: 0.85,
            repeat_penalty: 1.1,
            num_predict: 170,
            num_ctx: 2048,
          },
        },
      { timeoutMs },
    );

    const raw = await response.text();

    let payload: any = {};

    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(
        `Character description enhancer returned invalid JSON: ${raw.slice(0, 160)}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        payload?.error ||
          `Character description enhancer failed (${response.status}).`,
      );
    }

    const result = cleanText(
      payload?.response || "",
    )
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();

    if (!result) {
      throw new Error(
        "Character description enhancer returned no text.",
      );
    }

    return result;
  }
}

async function enhanceDescription(prompt: string) {
  const first = await generateWithOllama({
    instruction:
      characterDescriptionInstruction(),
    original: prompt,
  });

  if (!looksGeneric(first)) {
    return {
      text: first,
      refined: false,
    };
  }

  const refined = await generateWithOllama({
    instruction:
      refinementInstruction(),
    original: prompt,
    draft: first,
  });

  if (looksGeneric(refined)) {
    throw new Error(
      "Character description enhancer returned an overly generic result. The original description was preserved.",
    );
  }

  return {
    text: refined,
    refined: true,
  };
}

export async function POST(
  request: NextRequest,
) {
  try {
    const bodyRequest = request.clone();

    await getOwnerContext(request);

    const body: any = await bodyRequest
      .json()
      .catch(() => ({}));

    const prompt = cleanText(
      body?.prompt ||
        body?.description ||
        body?.text,
    );

    if (!prompt) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Character description is required.",
        },
        { status: 400 },
      );
    }

    if (prompt.length > 4000) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Character description is too long.",
        },
        { status: 400 },
      );
    }

    const result =
      await enhanceDescription(prompt);

    return NextResponse.json(
      {
        ok: true,
        originalDescription: prompt,
        enhancedDescription: result.text,
        enhancedPrompt: result.text,
        provider: "ollama",
        model: enhancerModel(),
        refined: result.refined,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error: any) {
    const message =
      error?.name === "AbortError"
        ? "Character description enhancer timed out. The original description was preserved."
        : error?.message || String(error);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: /session|auth|unauthor/i.test(
          message,
        )
          ? 401
          : 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
