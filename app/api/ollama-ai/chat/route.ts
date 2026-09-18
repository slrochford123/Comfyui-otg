import { NextRequest, NextResponse } from "next/server";
import {
  QWEN_CLUSTER_MODEL,
} from "@/lib/workers/qwenClusterRouter";
import {
  qwenDurableFetch,
} from "@/lib/workers/qwenDurableFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

const AI_ASSISTANCE_MODEL = "qwen3.5:4b";
const AI_ASSISTANCE_NUM_CTX = 16 * 1024;
const AI_ASSISTANCE_NUM_PREDICT = 500;
const AI_ASSISTANCE_KEEP_ALIVE = "30m";
const AI_ASSISTANCE_GUARD_TIMEOUT_MS = 45_000;
const AI_ASSISTANCE_GUARD_NUM_PREDICT = 500;
const DEFAULT_CHAT_MESSAGE_LIMIT = 12;
const STORY_HELPER_MESSAGE_LIMIT = 48;

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type AiAssistanceProfile =
  | "default"
  | "story-helper"
  | "describe";

type StoryHelperGuardMode = "strict" | "optional";

function cleanOutput(s: string) {
  return (s || "")
    .replace(/\r/g, "")
    .replace(/^json\s*/i, "")
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function truthy(value: string | undefined) {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function normalizeMessages(
  input: unknown,
  limit = DEFAULT_CHAT_MESSAGE_LIMIT,
): ChatMessage[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((m) => {
      const role: ChatMessage["role"] =
        m && typeof m === "object" && (m as Record<string, unknown>).role === "assistant"
          ? "assistant"
          : m && typeof m === "object" && (m as Record<string, unknown>).role === "system"
            ? "system"
            : "user";

      return {
        role,
        content: String(m && typeof m === "object" ? (m as Record<string, unknown>).content || "" : "").trim(),
      };
    })
    .filter((m) => m.content)
    .slice(-Math.max(1, Math.floor(limit)));
}

function buildSystemMessage(
  profile: AiAssistanceProfile
) {
  if (profile === "story-helper") {
    return {
      role: "system" as const,
      content: [
        "You are Story Helper inside the SLR Studios OTG app.",
        "Collaborate with the user on creative writing, story development, character development, plot progression, scenes, dialogue, pacing, screenplay structure, and brainstorming.",
        "The user's established story facts are canon unless the user explicitly asks to change them.",
        "Preserve established names, species, character identities, relationships, powers, locations, chronology, motivations, and prior events.",
        "Never silently replace or contradict established facts. If the protagonist is a rabbit, do not turn the protagonist into a mouse.",
        "Treat only details explicitly established by the user or already accepted in the conversation as story canon.",
        "When stating or summarizing established canon, preserve the user's meaning and level of specificity. Do not make an established fact more specific than the user made it.",
        "Do not silently reclassify a user's character or story element into a more specific narrative role. For example, 'character' does not mean 'protagonist', 'antagonist', 'hero', 'villain', 'parent', 'leader', or any other role unless the user established that role.",
        "Do not silently expand a user's location into a more specific geographic identity. For example, 'Boston' must remain 'Boston' rather than 'Boston, MA', and a city must not gain a state, province, country, neighborhood, district, or region unless the user established it.",
        "You may discuss plausible classifications, implications, or geographic interpretations as clearly labeled reasoning or suggestions, but never present them as established canon unless the user adopts them.",
        "Do not infer a character's sex, gender, pronouns, age, nationality, ethnicity, title, family role, or similar identity attribute from a name, appearance, stereotype, or convention. If the user has not established pronouns, avoid gendered pronouns when stating canon and refer to the character by name or use neutral wording.",
        "Do not silently give unnamed characters names. Until the user names them, refer to them descriptively, such as 'the bunny' or 'the wolf doctor'.",
        "Do not invent new powers, colors, relationships, personality traits, history, possessions, locations, or signature characteristics and then present them as if the user already established them.",
        "You may propose new creative details when useful, but clearly present them as optional suggestions rather than existing canon.",
        "A suggested detail does not become canon merely because you suggested it. Treat it as canon only after the user adopts, confirms, or builds on it.",
        "Assistant-authored suggestions from earlier replies are not canon unless the user explicitly adopted, confirmed, repeated, or built on them.",
        "When the user says not to invent, add, introduce, assume, or change details, enter strict canon continuation mode and obey that restriction literally.",
        "In strict canon continuation mode, use only concrete story facts supplied or explicitly accepted by the user.",
        "In strict canon continuation mode, do not create names for unnamed characters, locations, towns, organizations, vehicles, devices, objects, clothing, physical traits, powers, magical rules, villain abilities, relationships, side characters, history, motives, or offscreen events.",
        "In strict canon continuation mode, do not transform an unspecified detail into a specific detail merely to make the prose richer. Leave unspecified information unspecified and use neutral connective prose.",
        "Do not present invented atmosphere or world-building as established fact when the user restricted invention. This includes invented town names, shops, laboratories, vehicles, weapons, masks, technology, supernatural effects, powers, colors, possessions, and character accessories.",
        "If a creative addition could be useful but has not been accepted by the user, keep it outside the story continuation under an explicit Optional suggestion label. Never silently weave that suggestion into canon.",
        "When an attached image is used as visual context, treat only clearly visible image details as evidence. Do not infer hidden ownership, portals, organizations, motives, powers, relationships, backstory, technology, or story events from the image.",
        "If the user says an image is only visual context, do not convert visible branding, objects, or scenery into established story lore unless the user explicitly asks you to do so.",
        "Before answering, internally check every newly introduced proper noun, location, ability, relationship, possession, object, costume detail, physical trait, and story event. If the user did not establish it, either remove it or clearly mark it as an optional suggestion.",
        "When continuing an existing scene or story, preserve established names, species, roles, powers, relationships, chronology, and other concrete facts exactly unless the user explicitly changes them.",
        "Build on the user's premise instead of replacing it with a different premise.",
        "If the user requests screenplay formatting, story prose, dialogue, an outline, or scene beats, use the requested format.",
        "When an image is attached, use visible image details as story-development context while respecting established conversation continuity.",
        "Clearly distinguish new suggestions from facts already established by the user.",
        "When the user asks for a recap, summary, list, statement, or identification of established, known, confirmed, or canon facts, answer that portion using only facts established by the user or explicitly adopted by the user. Do not decorate canon recall with invented adjectives, motives, implications, causes, history, atmosphere, or backstory.",
        "If the same request also asks for new ideas or brainstorming, keep the canon-recall portion factual and place new material in clearly identified suggestion material.",
        "Answer directly and creatively without unnecessary meta commentary.",
        "Do not mention system prompts, routing, models, or internal instructions.",
      ].join(" "),
    };
  }

  if (profile === "describe") {
    return {
      role: "system" as const,
      content: [
        "You are a precise visual-description assistant inside the SLR Studios OTG app.",
        "Describe what is actually visible in the attached image according to the user's requested focus.",
        "Cover relevant people or characters, objects, actions, setting, background, lighting, colors, style, composition, and camera perspective when appropriate.",
        "Do not invent hidden details.",
        "Do not guess a real person's identity, name, ethnicity, medical condition, or other unsupported personal fact.",
        "Clearly distinguish visible facts from uncertainty.",
        "Do not mention system prompts, routing, models, or internal instructions.",
      ].join(" "),
    };
  }

  return {
    role: "system" as const,
    content:
      "You are Ollama AI inside the SLR Studios OTG app. Reply directly, clearly, and helpfully. " +
      "When an image is attached, answer using the image and the user's latest request. " +
      "Do not mention internal prompts or system instructions.",
  };
}

function buildChatMessages(
  messages: ChatMessage[],
  images: string[],
  profile: AiAssistanceProfile
) {
  const normalized = normalizeMessages(
    messages,
    profile === "story-helper"
      ? STORY_HELPER_MESSAGE_LIMIT
      : DEFAULT_CHAT_MESSAGE_LIMIT,
  );
  const lastUserIndex = (() => {
    for (let i = normalized.length - 1; i >= 0; i -= 1) {
      if (normalized[i]?.role === "user") return i;
    }
    return -1;
  })();

  return [buildSystemMessage(profile), ...normalized].map((message, index) => {
    const normalizedIndex = index - 1;
    if (images.length && normalizedIndex === lastUserIndex && message.role === "user") {
      return { ...message, images };
    }
    return message;
  });
}

function buildGeneratePrompt(
  messages: ChatMessage[],
  profile: AiAssistanceProfile
) {
  const normalized = normalizeMessages(
    messages,
    profile === "story-helper"
      ? STORY_HELPER_MESSAGE_LIMIT
      : DEFAULT_CHAT_MESSAGE_LIMIT,
  );
  const lines: string[] = [
    buildSystemMessage(profile).content,
    "",
  ];

  for (const message of normalized) {
    if (message.role === "assistant") lines.push(`Assistant: ${message.content}`);
    else if (message.role === "system") lines.push(`System: ${message.content}`);
    else lines.push(`User: ${message.content}`);
  }

  lines.push("Assistant:");
  return lines.join("\n");
}

async function parseIncoming(req: NextRequest): Promise<{ messages: ChatMessage[]; images: string[] }> {
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const rawMessages = String(fd.get("messages") || "[]");
    let messages: ChatMessage[] = [];

    try {
      messages = normalizeMessages(
        JSON.parse(rawMessages),
        STORY_HELPER_MESSAGE_LIMIT,
      );
    } catch {
      messages = [];
    }

    const image = fd.get("image");
    if (image instanceof File && image.size > 0) {
      const buf = Buffer.from(await image.arrayBuffer());
      return { messages, images: [buf.toString("base64")] };
    }

    return { messages, images: [] };
  }

  const body = await req.json().catch(() => null);
  const messages = normalizeMessages(
    body && typeof body === "object"
      ? (body as Record<string, unknown>).messages
      : [],
    STORY_HELPER_MESSAGE_LIMIT,
  );
  const rawImages = body && typeof body === "object" ? (body as Record<string, unknown>).images : [];
  const imageB64 = body && typeof body === "object" ? (body as Record<string, unknown>).imageB64 : "";

  const images = Array.isArray(rawImages)
    ? rawImages.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
    : typeof imageB64 === "string" && imageB64.trim()
      ? [imageB64.trim()]
      : [];

  return { messages, images };
}

function shouldFallbackToGenerate(status: number, rawError: string) {
  return status === 404 || /not support|unsupported|unknown|chat failed|model|images/i.test(rawError);
}

function readMessageContent(data: Record<string, unknown> | null) {
  if (!data) return "";

  if (typeof data.response === "string") return data.response;

  const message = data.message;
  if (message && typeof message === "object") {
    const content = (message as Record<string, unknown>).content;
    if (typeof content === "string") return content;
  }

  return "";
}

async function qwenFetchForChatRequest(
  path: "/api/generate" | "/api/chat",
  payload: Record<string, unknown>,
  timeoutMs: number,
  aiAssistance: boolean,
): Promise<Response> {
  if (!aiAssistance) {
    return qwenDurableFetch(
      path,
      payload,
      {
        timeoutMs,
        requestKind:
          "ollama-ai-chat",
      },
    );
  }

  /*
   * OTG_QWEN_CHAT_DURABLE_PRIORITY_V1
   *
   * AI Assistance historically preferred the RTX 3090 and used
   * the RTX 5060 Ti as fallback.
   *
   * Preserve that preference without a capacity deadline:
   *
   *   Shawn/3090 -> SLR/5060 -> durable wait -> retry
   */
  return qwenDurableFetch(
    path,
    payload,
    {
      requiredContextTokens:
        AI_ASSISTANCE_NUM_CTX,

      timeoutMs,

      allowedNodes:
        ["shawn", "slr"],

      model:
        AI_ASSISTANCE_MODEL,

      keepAlive:
        AI_ASSISTANCE_KEEP_ALIVE,

      requestKind:
        "ollama-ai-chat-ai-assistance",
    },
  );
}


function detectStoryHelperGuardMode(
  messages: ChatMessage[],
): StoryHelperGuardMode {
  const normalized = normalizeMessages(
    messages,
    STORY_HELPER_MESSAGE_LIMIT,
  );

  const latestUser = [...normalized]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUser) return "optional";

  const text = latestUser.content.toLowerCase();

  const strictPatterns: RegExp[] = [
    /\b(?:strict canon|canon only|established canon only)\b/i,
    /\b(?:do not|don't|dont|never)\s+(?:invent|add|introduce|assume|change|create|fabricate|make up)\b/i,
    /\bwithout\s+(?:inventing|adding|introducing|assuming|changing|creating|fabricating|making up)\b/i,
    /\bno\s+(?:new|additional|invented)\s+(?:details?|facts?|lore|characters?|locations?|powers?|abilities?|events?)\b/i,
    /\b(?:use|using|include|including|continue with)\s+only\s+(?:what|the\s+(?:established|existing|confirmed|given|user-provided))\b/i,
    /\b(?:only use|use only)\s+(?:what|details|facts|information)\s+(?:i|the user)\b/i,
    /\b(?:visual context only|only visual context|not story canon|not canon|not story lore)\b/i,
  ];

  if (strictPatterns.some((pattern) => pattern.test(text))) {
    return "strict";
  }

  const creativeRequestPatterns: RegExp[] = [
    /\b(?:brainstorm|brainstorming|suggest|suggestions?|ideas?|options?|possibilities|possible directions?|what could happen|what might happen|propose|invent|create new|add new)\b/i,
    /\b(?:give|show|offer)\s+me\s+(?:some\s+)?(?:ideas?|options?|suggestions?)\b/i,
  ];

  const canonRecallPatterns: RegExp[] = [
    /\b(?:state|list|summari[sz]e|recap|repeat|restate|tell me|give me|identify)\b[\s\S]{0,120}\b(?:established|existing|confirmed|known|current|user-provided|canon(?:ical)?)\b[\s\S]{0,60}\b(?:facts?|details?|information|canon)\b/i,
    /\b(?:what\s+(?:do|have)\s+we\s+(?:know|established)|what\s+is\s+(?:already\s+)?(?:established|confirmed|known|canon)|canon\s+so\s+far|established\s+facts?)\b/i,
    /\bonly\s+(?:those|these|the)?\s*(?:established|existing|confirmed|known|user-provided|canon(?:ical)?)\s+(?:facts?|details?|information)\b/i,
  ];

  const creativeRequested = creativeRequestPatterns.some(
    (pattern) => pattern.test(text),
  );

  if (
    !creativeRequested &&
    canonRecallPatterns.some((pattern) => pattern.test(text))
  ) {
    return "strict";
  }

  return "optional";
}

function buildStoryHelperGuardEvidence(
  messages: ChatMessage[],
  draft: string,
  mode: StoryHelperGuardMode,
) {
  const transcript = normalizeMessages(
    messages,
    STORY_HELPER_MESSAGE_LIMIT,
  )
    .map(
      (message, index) =>
        `[${message.role.toUpperCase()} ${index + 1}] ${message.content}`,
    )
    .join("\n\n");

  const modeRules =
    mode === "strict"
      ? [
          "STRICT CANON MODE:",
          "Rewrite the draft using only concrete story facts established by the user or explicitly adopted by the user.",
          "Remove every unsupported new name, location, character, object, action, ability, power, color, costume detail, physical trait, relationship, motive, backstory, possession, rule, event, or atmospheric fact.",
          "Do not replace a removed invention with a different invention.",
          "Leave unspecified details unspecified.",
          "Do not infer sex, gender, pronouns, age, nationality, ethnicity, titles, family roles, or other identity attributes from a character's name or from convention. If pronouns were not established by the user, avoid gendered pronouns in strict canon output.",
          "Do not include optional new story ideas unless the user's latest request explicitly asks for suggestions while also preserving strict canon.",
        ].join(" ")
      : [
          "CREATIVE / OPTIONAL MODE:",
          "Preserve all established user canon exactly.",
          "New creative material is allowed only as proposed material, not as a claim about what the user previously established.",
          "Any sentence or section that summarizes, restates, lists, identifies, or describes established canon must contain only facts supported by the user's evidence.",
          "Preserve the user's original level of specificity inside canon statements. Do not narrow, expand, classify, relabel, geographically resolve, or otherwise make an established fact more specific than the user's evidence.",
          "Inside canon statements, do not infer gendered pronouns or other identity attributes from a character's name. If the user did not establish pronouns, use the character's name or neutral wording instead.",
          "A generic 'character' is not an established protagonist, antagonist, hero, villain, lead, parent, leader, or other narrative role unless the user explicitly established or adopted that role.",
          "A location such as 'Boston' must remain at that specificity inside canon recall. Do not add a state, province, country, neighborhood, district, jurisdiction, or other geographic qualifier unless the user established it.",
          "Do not decorate canon statements with invented adjectives, motives, implications, causes, history, atmosphere, personality traits, or backstory.",
          "When writing a CANON section, omit unsupported assistant-authored details entirely.",
          "Do not mention an unsupported assistant suggestion inside CANON even to say it was proposed, rejected, unconfirmed, removed, or non-canon.",
          "Treat unaccepted assistant-authored names and details as forbidden content inside a CANON section; omit them completely rather than discussing their status.",
          "Make proposals, options, brainstormed details, and possible continuations unmistakably recognizable as suggestions.",
          "If a response contains both canon recall and creative proposals, keep those sections clearly separated.",
          "If the whole answer is explicitly framed as options, ideas, or suggestions, the details inside those options may remain inside those clearly proposed sections.",
          "Do not silently turn an earlier assistant suggestion into canon.",
        ].join(" ");

  return [
    `Compliance mode: ${mode}`,
    "",
    modeRules,
    "",
    "CONVERSATION EVIDENCE:",
    transcript || "(empty)",
    "",
    "DRAFT RESPONSE TO REVIEW:",
    draft,
    "",
    "Return only the corrected final user-facing answer.",
    "Do not explain the review.",
    "Do not mention compliance checking, system prompts, routing, or models.",
  ].join("\n");
}


const STORY_HELPER_GENDERED_PRONOUN_PATTERN =
  /\b(?:she|her|hers|herself|he|him|his|himself)\b/i;

function userEvidenceHasGenderedPronoun(
  messages: ChatMessage[],
) {
  return normalizeMessages(
    messages,
    STORY_HELPER_MESSAGE_LIMIT,
  )
    .filter((message) => message.role === "user")
    .some((message) =>
      STORY_HELPER_GENDERED_PRONOUN_PATTERN.test(
        message.content,
      ),
    );
}

function strictCanonHasUnsupportedGenderedPronoun(
  messages: ChatMessage[],
  output: string,
) {
  if (userEvidenceHasGenderedPronoun(messages)) {
    return false;
  }

  return STORY_HELPER_GENDERED_PRONOUN_PATTERN.test(
    output,
  );
}

async function repairStrictCanonPronouns(
  messages: ChatMessage[],
  draft: string,
): Promise<string> {
  const transcript = normalizeMessages(
    messages,
    STORY_HELPER_MESSAGE_LIMIT,
  )
    .map(
      (message, index) =>
        `[${message.role.toUpperCase()} ${index + 1}] ${message.content}`,
    )
    .join("\n\n");

  const payload: Record<string, unknown> = {
    model: AI_ASSISTANCE_MODEL,
    stream: false,
    messages: [
      {
        role: "system",
        content: [
          "You are a deterministic strict-canon correction editor.",
          "The user evidence contains no established gendered pronouns.",
          "Rewrite the supplied answer without using she, her, hers, herself, he, him, his, or himself.",
          "Use the character's established name or neutral wording.",
          "Do not add facts.",
          "Do not infer gender, sex, age, role, nationality, ethnicity, relationships, powers, profession, history, or geography.",
          "Do not list unestablished categories merely to say they are unknown.",
          "Preserve only concrete facts supported by the user evidence.",
          "Return only the corrected user-facing answer.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          "USER EVIDENCE:",
          transcript || "(empty)",
          "",
          "ANSWER TO CORRECT:",
          draft,
          "",
          "Return the corrected answer only.",
        ].join("\n"),
      },
    ],
    options: {
      temperature: 0.0,
      top_p: 0.5,
      repeat_penalty: 1.05,
      num_predict: AI_ASSISTANCE_GUARD_NUM_PREDICT,
    },
    think: false,
  };

  try {
    const response = await qwenFetchForChatRequest(
      "/api/chat",
      payload,
      AI_ASSISTANCE_GUARD_TIMEOUT_MS,
      true,
    );

    const raw = await response.text();

    let data: Record<string, unknown> | null = null;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return "";
    }

    return cleanOutput(
      readMessageContent(data),
    );
  } catch {
    return "";
  }
}


async function repairOptionalStoryHelperPronouns(
  messages: ChatMessage[],
  draft: string,
): Promise<string> {
  const transcript = normalizeMessages(
    messages,
    STORY_HELPER_MESSAGE_LIMIT,
  )
    .map(
      (message, index) =>
        `[${message.role.toUpperCase()} ${index + 1}] ${message.content}`,
    )
    .join("\n\n");

  const payload: Record<string, unknown> = {
    model: AI_ASSISTANCE_MODEL,
    stream: false,
    messages: [
      {
        role: "system",
        content: [
          "You are a deterministic Story Helper wording editor.",
          "The user evidence contains no established gendered pronouns.",
          "Rewrite the supplied answer only as needed to remove she, her, hers, herself, he, him, his, or himself.",
          "Use the character's established name, they/them, or neutral wording.",
          "Preserve the draft's creative suggestions, questions, reasoning, tone, and structure.",
          "Keep proposals clearly labeled as suggestions or possibilities and never promote them to established canon.",
          "Do not add facts or infer gender, sex, age, role, nationality, ethnicity, relationships, powers, profession, history, or geography.",
          "Return only the corrected user-facing answer.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          "USER EVIDENCE:",
          transcript || "(empty)",
          "",
          "ANSWER TO CORRECT:",
          draft,
          "",
          "Return the corrected answer only.",
        ].join("\n"),
      },
    ],
    options: {
      temperature: 0.0,
      top_p: 0.5,
      repeat_penalty: 1.05,
      num_predict: AI_ASSISTANCE_GUARD_NUM_PREDICT,
    },
    think: false,
  };

  try {
    const response = await qwenFetchForChatRequest(
      "/api/chat",
      payload,
      AI_ASSISTANCE_GUARD_TIMEOUT_MS,
      true,
    );

    const raw = await response.text();

    let data: Record<string, unknown> | null = null;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return "";
    }

    return cleanOutput(
      readMessageContent(data),
    );
  } catch {
    return "";
  }
}

async function enforceStoryHelperCompliance(
  messages: ChatMessage[],
  images: string[],
  draft: string,
  mode: StoryHelperGuardMode,
): Promise<string> {
  const systemContent = [
    "You are the final continuity and canon compliance editor for Story Helper.",
    "Your job is to rewrite a draft response so it obeys the user's established story canon.",
    "Concrete story facts stated by the user are authoritative.",
    "Earlier assistant-authored additions are not canon unless a later user message explicitly adopts, confirms, repeats, or builds on them.",
    "Never change an established name, species, identity, relationship, power, location, chronology, motivation, or event.",
    "Never promote an unaccepted assistant suggestion into canon.",
    "When stating established canon, preserve the user's exact level of specificity. Do not infer a more specific narrative role, classification, geographic identity, relationship, or other qualifier and present it as established.",
    "For example, a user-established 'character' is not automatically a protagonist, and user-established 'Boston' is not automatically 'Boston, MA'. Such interpretations may appear only as clearly labeled reasoning or suggestions unless the user adopts them.",
    "Do not infer sex, gender, pronouns, age, nationality, ethnicity, titles, family roles, or other identity attributes from a person's or character's name. If the user has not established pronouns, remove unsupported gendered pronouns from canon statements and use the name or neutral wording.",
    "An attached image may establish what is visibly present in the image, but visible image details are not automatically story lore or canon.",
    "If the user says an image is visual context only, keep image-derived design cues separate from story canon.",
    "Do not infer hidden ownership, motives, powers, organizations, relationships, technology, history, or offscreen events from an image.",
    "When the requested mode is strict, remove unsupported specifics instead of creatively repairing them.",
    "When the requested mode is optional, preserve creativity while making proposed additions clearly distinguishable from established canon.",
    "If any portion of the user's request asks what is already established, known, confirmed, or canon, that portion must contain only user-supported facts even when the overall request also includes brainstorming.",
    "A CANON or established-facts section must never mention an unaccepted assistant-only proposal, even to explain that it was rejected, unconfirmed, removed, or non-canon.",
    "Omit unsupported assistant-authored material from canon sections completely instead of naming it and then disclaiming it.",
    "Return only the corrected user-facing response.",
  ].join(" ");

  const guardMessages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: systemContent,
    },
    {
      role: "user",
      content: buildStoryHelperGuardEvidence(
        messages,
        draft,
        mode,
      ),
      ...(images.length ? { images } : {}),
    },
  ];

  const payload: Record<string, unknown> = {
    model: AI_ASSISTANCE_MODEL,
    stream: false,
    messages: guardMessages,
    options: {
      temperature: 0.05,
      top_p: 0.8,
      repeat_penalty: 1.05,
      num_predict: AI_ASSISTANCE_GUARD_NUM_PREDICT,
    },
    think: false,
  };

  try {
    const response = await qwenFetchForChatRequest(
      "/api/chat",
      payload,
      AI_ASSISTANCE_GUARD_TIMEOUT_MS,
      true,
    );

    const raw = await response.text();

    let data: Record<string, unknown> | null = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (response.ok) {
      const corrected = cleanOutput(readMessageContent(data));

      if (corrected) {
        if (
          strictCanonHasUnsupportedGenderedPronoun(
            messages,
            corrected,
          )
        ) {
          const repaired =
            mode === "strict"
              ? await repairStrictCanonPronouns(
                  messages,
                  corrected,
                )
              : await repairOptionalStoryHelperPronouns(
                  messages,
                  corrected,
                );

          if (
            repaired &&
            !strictCanonHasUnsupportedGenderedPronoun(
              messages,
              repaired,
            )
          ) {
            return repaired;
          }

          return [
            "I could not verify this response against the established canon",
            "without introducing an unsupported identity detail.",
            "Please retry the request.",
          ].join(" ");
        }

        return corrected;
      }
    }
  } catch {
    // Strict mode fails closed below.
    // Optional creative mode may retain the original draft.
  }

  if (mode === "strict") {
    return [
      "I could not verify this continuation against the established canon,",
      "so I will not add unverified story details.",
      "Please retry the request.",
    ].join(" ");
  }

  if (
    strictCanonHasUnsupportedGenderedPronoun(
      messages,
      draft,
    )
  ) {
    const repaired =
      await repairOptionalStoryHelperPronouns(
        messages,
        draft,
      );

    if (
      repaired &&
      !strictCanonHasUnsupportedGenderedPronoun(
        messages,
        repaired,
      )
    ) {
      return repaired;
    }

    return [
      "I could not safely phrase this response without introducing",
      "an unsupported identity detail. Please retry the request.",
    ].join(" ");
  }

  return draft;
}

export async function POST(req: NextRequest) {
  try {
    const { messages, images } = await parseIncoming(req);
    if (!messages.length) {
      return NextResponse.json({ error: "Missing messages" }, { status: 400 });
    }

    const aiAssistance =
      req.headers.get("x-otg-ai-assistance") === "1";

    const requestedProfile = req.headers
      .get("x-otg-ai-assistance-profile")
      ?.trim()
      .toLowerCase();

    const aiAssistanceProfile: AiAssistanceProfile =
      aiAssistance &&
      requestedProfile === "story-helper"
        ? "story-helper"
        : aiAssistance &&
            requestedProfile === "describe"
          ? "describe"
          : "default";

    const model = aiAssistance
      ? AI_ASSISTANCE_MODEL
      : QWEN_CLUSTER_MODEL;

    const storyHelperGuardMode: StoryHelperGuardMode | null =
      aiAssistanceProfile === "story-helper"
        ? detectStoryHelperGuardMode(messages)
        : null;

    const timeoutMs = parsePositiveInt(process.env.OLLAMA_CHAT_TIMEOUT_MS, images.length ? 180000 : 90000);
    const numThread = parsePositiveInt(process.env.OLLAMA_CHAT_NUM_THREAD || process.env.OLLAMA_ENHANCE_NUM_THREAD, 0);
    const keepAliveOff = truthy(process.env.OLLAMA_CHAT_KEEPALIVE_OFF) || truthy(process.env.OLLAMA_ENHANCE_KEEPALIVE_OFF);

    const options: Record<string, unknown> = {
      temperature:
        aiAssistanceProfile === "story-helper"
          ? 0.72
          : aiAssistanceProfile === "describe"
            ? 0.25
            : 0.45,
      top_p: 0.9,
      repeat_penalty: 1.08,
      num_predict: aiAssistance
        ? AI_ASSISTANCE_NUM_PREDICT
        : 900,
    };
    if (numThread > 0) options.num_thread = numThread;

    const chatPayload: Record<string, unknown> = {
      model,
      stream: false,
      messages: buildChatMessages(
      messages,
      images,
      aiAssistanceProfile
    ),
      options,
    };
    if (aiAssistance) chatPayload.think = false;
  if (keepAliveOff) chatPayload.keep_alive = "0s";

    try {
      const chatResponse = await qwenFetchForChatRequest(
      "/api/chat",
      chatPayload,
      timeoutMs,
      aiAssistance,
    );
      const chatRaw = await chatResponse.text();
      let chatData: Record<string, unknown> | null = null;
      try { chatData = chatRaw ? JSON.parse(chatRaw) : null; } catch { chatData = null; }
      const chat = { ok: chatResponse.ok, status: chatResponse.status, raw: chatRaw, data: chatData };
      if (chat.ok) {
        const draftMessage = cleanOutput(readMessageContent(chat.data));
        if (draftMessage) {
          const message = storyHelperGuardMode
            ? await enforceStoryHelperCompliance(
                messages,
                images,
                draftMessage,
                storyHelperGuardMode,
              )
            : draftMessage;

          return NextResponse.json(
            {
              message,
              model,
              cpuOnly: false,
              ...(storyHelperGuardMode
                ? { storyHelperGuard: storyHelperGuardMode }
                : {}),
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
      }

      const rawError = String(chat.data?.error || chat.raw || "");
      if (!shouldFallbackToGenerate(chat.status, rawError)) {
        return NextResponse.json({ error: rawError || "Ollama chat failed" }, { status: 502 });
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return NextResponse.json({ error: `Ask AI timed out after ${Math.round(timeoutMs / 1000)} seconds.` }, { status: 504 });
      }

      const message = error instanceof Error ? error.message : String(error);
      if (!shouldFallbackToGenerate(500, message)) {
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }

    const generatePayload: Record<string, unknown> = {
      model,
      stream: false,
      prompt: buildGeneratePrompt(
      messages,
      aiAssistanceProfile
    ),
      options,
    };
    if (images.length) generatePayload.images = images;
    if (aiAssistance) generatePayload.think = false;
  if (keepAliveOff) generatePayload.keep_alive = "0s";

    const generateResponse = await qwenFetchForChatRequest(
    "/api/generate",
    generatePayload,
    timeoutMs,
    aiAssistance,
  );
    const generateRaw = await generateResponse.text();
    let generateData: Record<string, unknown> | null = null;
    try { generateData = generateRaw ? JSON.parse(generateRaw) : null; } catch { generateData = null; }
    const generate = { ok: generateResponse.ok, status: generateResponse.status, raw: generateRaw, data: generateData };
    if (!generate.ok) {
      return NextResponse.json({ error: String(generate.data?.error || generate.raw || "Ollama generate failed") }, { status: 502 });
    }

    const draftMessage = cleanOutput(readMessageContent(generate.data));
    if (!draftMessage) {
      return NextResponse.json({ error: "Empty Ollama response" }, { status: 502 });
    }

    const message = storyHelperGuardMode
      ? await enforceStoryHelperCompliance(
          messages,
          images,
          draftMessage,
          storyHelperGuardMode,
        )
      : draftMessage;

    return NextResponse.json(
      {
        message,
        model,
        cpuOnly: false,
        ...(storyHelperGuardMode
          ? { storyHelperGuard: storyHelperGuardMode }
          : {}),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "Ask AI timed out." }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) || 500 : 500;
    return NextResponse.json({ error: message || "Ask AI failed" }, { status });
  }
}
