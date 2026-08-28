import { NextRequest, NextResponse } from "next/server";
import { getOwnerContext } from "@/lib/ownerKey";
import { QWEN_CLUSTER_MODEL, qwenClusterFetch } from "@/lib/workers/qwenClusterRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Legacy OLLAMA_CHARACTER_DESCRIPTION_URL and OLLAMA_BASE_URL configuration
// names remain documented for compatibility; endpoint selection now belongs
// exclusively to qwenClusterFetch so routes cannot bypass GPU arbitration.


function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function characterDescriptionInstruction() {
  return [
    "/no_think",
    "",
    "Create one detailed, generation-ready visual character description.",
    "Preserve every explicit fact supplied by the user.",
    "Clarify vague concepts by making concrete, coherent visual choices.",
    "Describe the actual character, not categories of details that should be added.",
    "",
    "When relevant, specify:",
    "- species, breed-like physical traits, or material/body interpretation",
    "- body build and proportions",
    "- fur, skin, hair, scales, metal, wood, or other surface qualities",
    "- face, muzzle or facial structure, eyes, ears, markings, horns, scars, or other defining features",
    "- exact clothing pieces, colors, fabrics, protective materials, stitching, closures, and trim",
    "- footwear",
    "- role-specific equipment and accessories",
    "- believable scratches, soot, dirt, wear, fading, dents, or material variation",
    "",
    "Interpret the input as a fictional visual character design unless the user explicitly asks for a documentary or realistic working-animal description.",
    "When an animal or creature is paired with a human occupation, the animal or creature IS the character performing that occupation.",
    "If the user does not explicitly request realistic quadruped anatomy, an animal combined with a human occupation may be interpreted as an anthropomorphic character while preserving its species identity.",
    "Give that character visible role-appropriate clothing, protective gear, tools, and equipment rather than describing it as an animal assisting human workers.",
    "Do not explain what an occupation means, what duties it performs, what training it requires, or how real-world animals participate in that occupation.",
    "All occupational clothing and equipment must be practical, physically plausible, and appropriate to the role.",
    "Do not attach tools, hoses, weapons, radios, or other equipment to the character's neck, collar, face, or body unless that placement is genuinely normal and functional.",
    "Prefer recognizable real-world occupational gear when the concept names a real occupation.",
    "",
    "Do not write generic phrases such as 'distinctive face', 'readable silhouette', 'surface detail', 'layered practical clothing', 'coordinated colors', 'recognizable design', or 'consistent with the original concept'.",
    "Do not explain your reasoning or discuss what you are going to add.",
    "Do not add lore, backstory, personality, powers, environment, pose, camera, lighting, rendering style, art style, or quality tags.",
    "Do not sexualize a character described as a child or teenager.",
    "",
    "Write one natural paragraph around 80-120 words.",
    "Return exactly one JSON object with a single string field named \"description\".",
    "Put only the finished character description inside the description field.",
    "Do not return analysis, reasoning, notes, markdown, or any text outside the JSON object.",
  ].join("\n");
}

function looksGenericOrMeta(value: string) {
  const normalized = cleanText(value).toLowerCase();

  const rejected = [
    "distinctive face",
    "readable silhouette",
    "surface detail",
    "layered practical clothing",
    "coordinated colors",
    "recognizable design",
    "consistent with the original concept",
    "the user wants",
    "i need to",
    "i should",
    "i will",
    "instructions",
    "original concept",
  ];

  const explanatoryPatterns = [
    /\bis a real-world\b/,
    /\bare a real-world\b/,
    /\breal-world occupational role\b/,
    /\btrained to assist\b/,
    /\bworking alongside\b/,
    /\bspecialized training\b/,
    /\btypically undergo\b/,
    /\bshould be depicted\b/,
    /\bthe character should\b/,
    /\brole where\b/,
    /\boccupation where\b/,
    /\bprovide support during\b/,
    /\bsearch for victims\b/,
    /\bdetect smoke\b/,
  ];

  return (
    normalized.split(/\s+/).filter(Boolean).length < 45 ||
    rejected.some((phrase) => normalized.includes(phrase)) ||
    explanatoryPatterns.some((pattern) => pattern.test(normalized))
  );
}

async function enhanceDescription(prompt: string) {
  const requestPrompt = [
    characterDescriptionInstruction(),
    "",
    "Original concept:",
    prompt,
  ].join("\n");

  const response = await qwenClusterFetch(
    "/api/generate",
    {
      stream: false,
      think: false,
      prompt: requestPrompt,
      format: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              "One finished 80-120 word generation-ready visual character description with no reasoning or meta commentary.",
          },
        },
        required: ["description"],
        additionalProperties: false,
      },
      options: {
        temperature: 0.2,
        top_p: 0.85,
        repeat_penalty: 1.08,
        num_predict: 220,
        num_ctx: 2048,
      },
    },
    {
      model: "qwen3:4b",
      keepAlive: 0,
      timeoutMs: 8_000,
      waitMs: 1_000,
      leaseTtlSeconds: 30,
    },
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

  const rawResponse = cleanText(payload?.response || "");

  if (!rawResponse) {
    throw new Error(
      "Character description enhancer returned no description.",
    );
  }

  let result = "";

  // Prefer Ollama structured output, but tolerate a valid plain-text
  // character description if the model does not serialize the schema
  // perfectly on a particular generation.
  const parseStructured = (value: string): string => {
    try {
      const parsed = JSON.parse(value);

      if (typeof parsed === "string") {
        return cleanText(parsed);
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.description === "string"
      ) {
        return cleanText(parsed.description);
      }
    } catch {
      // Fall through to alternate representations.
    }

    return "";
  };

  result = parseStructured(rawResponse);

  if (!result) {
    const fenced = rawResponse.match(
      /```(?:json)?\s*([\s\S]*?)```/i,
    );

    if (fenced?.[1]) {
      result = parseStructured(fenced[1].trim());
    }
  }

  if (!result) {
    const objectStart = rawResponse.indexOf("{");
    const objectEnd = rawResponse.lastIndexOf("}");

    if (objectStart >= 0 && objectEnd > objectStart) {
      result = parseStructured(
        rawResponse.slice(objectStart, objectEnd + 1),
      );
    }
  }

  if (!result) {
    // The prompt already requires only the finished description.
    // Accept plain text, then subject it to the same quality guard below.
    result = rawResponse;
  }

  result = cleanText(result);

  if (!result) {
    throw new Error(
      "Character description enhancer returned no usable description.",
    );
  }

  if (looksGenericOrMeta(result)) {
    const debugWordCount = result
      .split(/\s+/)
      .filter(Boolean).length;


    throw new Error(
      "Character description enhancer returned an unusable result. Please try Enhance Prompt again.",
    );
  }

  return {
    text: result,
    refined: false,
    fallback: false,
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
        model: "qwen3:4b",
        refined: result.refined,
        fallbackUsed: false,
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
