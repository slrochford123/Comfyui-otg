import { after, NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

import { validateH3LoraSelections } from "@/lib/h3LoraCatalogServer";
import { characterRefSelectionBackend, makeH3SmartReferenceInput } from "@/lib/h3SmartReferencesServer";
import { DEFAULT_H3_STYLE_PRESET_ID, resolveH3StylePreset, resolveH3StylePresetByLabel } from "@/lib/h3StylePresets";
import { claimH3DirectorRequest, finishH3DirectorRequest, readH3DirectorRequest } from "@/lib/openai/h3DirectorRequests";
import { getH3DirectorConversation, upsertH3DirectorConversation } from "@/lib/openai/h3DirectorStore";
import {
  compileH3SceneDirection,
  H3_DIRECTED_PROMPT_FORMAT,
  h3SceneDirectionInstructions,
  h3SceneDirectionSchema,
  validateH3DirectedDialogue,
  type H3SceneDirectionContext,
} from "@/lib/openai/h3SceneDirection";
import { openAIModels } from "@/lib/openai/provider";
import { SessionInvalidError } from "@/lib/ownerKey";
import { H3_PRODUCTION_DURATION_OPTIONS, type H3ProductionDuration } from "@/lib/production/h3ProductionRecipes";
import { requireSessionUser } from "@/lib/sessionUser";
import { createAssistantText, resolveReviewedAssistantProvider, withAssistantProvider } from "@/lib/workers/assistantProvider";
import { h3CharacterVoiceBindings, type H3SmartReferenceMapEntry } from "@/lib/h3SmartReferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

const MAX_VISUAL_INPUTS = 3;
const MAX_VISUAL_INPUT_LENGTH = 350_000;
const MAX_REQUEST_LENGTH = 1_200_000;
const IMAGE_DATA_URL = /^data:image\/jpeg;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MODES = ["h3-text-to-video", "h3-image-to-video", "h3-reference-to-video"];

type DirectorBody = Record<string, unknown>;
type ReferenceBinding = { label: string; name: string; description: string; clipStartSeconds?: number; source?: string }
  & Partial<Pick<H3SmartReferenceMapEntry, "kind" | "characterKey" | "characterName" | "voiceId">>;
type VisualInput = { label: string; dataUrl: string };

function jsonError(error: unknown) {
  const status = error instanceof SessionInvalidError ? 401
    : typeof error === "object" && error && "status" in error ? Number(error.status || 400)
    : 400;
  return NextResponse.json(
    { ok: false, error: error instanceof Error ? error.message : "H3 AI Director request failed." },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function cleanText(value: unknown, limit = 4000) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, limit) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function referenceContext(body: DirectorBody, ownerKey: string) {
  const mode = body.mode || "h3-text-to-video";
  if (typeof mode !== "string" || !MODES.includes(mode)) throw new Error("Choose Text, Image, or Reference before directing.");
  const durationSeconds = Number(body.durationSeconds ?? 5) as H3ProductionDuration;
  if (!H3_PRODUCTION_DURATION_OPTIONS.includes(durationSeconds)) throw new Error("Choose a 5- or 10-second duration for H3 Direct.");
  const firstImageName = cleanText(body.firstImageName, 120);
  const lastImageName = cleanText(body.lastImageName, 120);
  const context: H3SceneDirectionContext = {
    mode: mode as H3SceneDirectionContext["mode"], durationSeconds,
    firstImage: false, lastImage: false, pictures: 0, videos: 0, audios: 0,
  };
  const references: ReferenceBinding[] = [];
  if (mode === "h3-text-to-video") return { context, references };

  if (mode === "h3-image-to-video") {
    if (!firstImageName) throw new Error("Choose a First Image before directing.");
    context.firstImage = true;
    context.lastImage = Boolean(lastImageName);
    references.push({ label: "First Image", name: firstImageName, description: "Opening composition at 0.00 seconds." });
    if (lastImageName) references.push({ label: "Last Image", name: lastImageName, description: "Ending composition at the selected clip duration." });
    return { context, references };
  }

  const selected = Array.isArray(body.references) ? body.references.filter(isRecord) : [];
  const pictures = selected.filter(item => item.kind === "image");
  const videos = selected.filter(item => item.kind === "video");
  const audios = selected.filter(item => item.kind === "audio");
  if (pictures.length > 9 || videos.length > 3 || audios.length > 3 || selected.length > 12) {
    throw new Error("Reduce the number of selected references before directing.");
  }
  if (body.smartReferences != null) {
    const target = body.targetBackend;
    if (target != null && target !== "auto" && target !== "rtx3090" && target !== "rtx5060ti") {
      throw new Error("Choose a supported H3 reference GPU.");
    }
    const selectedBackend = await characterRefSelectionBackend(body.smartReferences, target === "rtx3090" || target === "rtx5060ti" ? target : undefined, ownerKey);
    const asset = (item: Record<string, unknown>) => ({ path: "", name: cleanText(item.name, 120), description: cleanText(item.description, 400) });
    const firstFrame = firstImageName ? { path: "", name: firstImageName, description: "Opening composition at 0.00 seconds." } : null;
    const videoDetails = videos.map(item => ({ ...asset(item), includeAudio: item.includeAudio === true }));
    const smart = await makeH3SmartReferenceInput(body.smartReferences, selectedBackend || "rtx3090", pictures.map(asset), firstFrame,
      videos.length, audios.length, { videos: videoDetails, audios: audios.map(asset) }, ownerKey);
    if (smart) {
      context.firstImage = Boolean(smart.firstFrame);
      context.pictures = smart.referenceMap.filter(item => item.kind === "image").length;
      context.videos = smart.referenceMap.filter(item => item.kind === "video").length;
      context.audios = smart.referenceMap.filter(item => item.kind === "audio").length;
      context.characterVoiceBindings = h3CharacterVoiceBindings(smart.referenceMap);
      if (smart.firstFrame) references.push({ label: "First Image", name: smart.firstFrame.name, description: smart.firstFrame.description });
      for (const { tag, name, description, source, kind, characterKey, characterName, voiceId } of smart.referenceMap) {
        references.push({ label: tag, name, description, source, kind, characterKey, characterName, voiceId });
      }
      if (!references.length) throw new Error("Choose at least one reference before directing.");
      return { context, references };
    }
  }
  if (!pictures.length && !videos.length && !audios.length) throw new Error("Choose at least one reference before directing.");
  context.pictures = pictures.length;
  context.videos = videos.length;

  function bind(item: Record<string, unknown>, label: string) {
    const clipStartSeconds = Number(item.clipStartSeconds ?? 0);
    references.push({
      label,
      name: cleanText(item.name, 120),
      description: cleanText(item.description, 400),
      ...(item.kind === "video" && Number.isFinite(clipStartSeconds) && clipStartSeconds >= 0 ? { clipStartSeconds } : {}),
    });
  }

  pictures.forEach((item, index) => bind(item, `<Picture ${index + 1}>`));
  videos.forEach((item, index) => {
    const label = `<Video ${index + 1}>`;
    bind(item, label);
    if (item.includeAudio === true) references.push({ label: `<Audio ${++context.audios}>`, name: "", description: "Selected source sound", source: label });
  });
  audios.forEach(item => bind(item, `<Audio ${++context.audios}>`));
  return { context, references };
}

async function readVisualInputs(value: unknown, references: ReferenceBinding[]) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_VISUAL_INPUTS) throw new Error("H3 Direct accepts up to three selected stills.");
  const labels = new Set(references.filter(item => !item.label.startsWith("<Audio")).map(item => item.label));
  return Promise.all(value.map(async (item): Promise<VisualInput> => {
    if (!isRecord(item) || typeof item.label !== "string" || !labels.has(item.label)
        || typeof item.dataUrl !== "string" || item.dataUrl.length > MAX_VISUAL_INPUT_LENGTH || !IMAGE_DATA_URL.test(item.dataUrl)) {
      throw new Error("H3 Direct received an invalid still or reference label.");
    }
    const bytes = Buffer.from(item.dataUrl.slice("data:image/jpeg;base64,".length), "base64");
    const image = await sharp(bytes, { limitInputPixels: 1_048_576 }).metadata().catch(() => null);
    if (image?.format !== "jpeg" || !image.width || !image.height || image.width > 1024 || image.height > 1024
        || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
      throw new Error("H3 Direct received an unreadable or oversized JPEG still.");
    }
    return { label: item.label, dataUrl: item.dataUrl };
  }));
}

function providerInput(text: string, visuals: VisualInput[]) {
  if (!visuals.length) return [{ role: "user", content: text }];
  return [{ role: "user", content: [
    { type: "input_text", text },
    ...visuals.flatMap(({ label, dataUrl }) => [
      { type: "input_text", text: `Selected visual evidence for ${label}:` },
      { type: "input_image", image_url: dataUrl, detail: "low" },
    ]),
  ] }];
}

function directorStyle(body: DirectorBody) {
  const requested = cleanText(body.stylePresetId, 120);
  const preset = requested && requested !== DEFAULT_H3_STYLE_PRESET_ID
    ? resolveH3StylePreset(requested)
    : resolveH3StylePresetByLabel(cleanText(body.visualStyle, 120));
  if (requested && requested !== DEFAULT_H3_STYLE_PRESET_ID && !preset) throw new Error("Choose a valid H3 visual style.");
  return preset?.id && preset.id !== DEFAULT_H3_STYLE_PRESET_ID ? { label: preset.label, visualTraits: preset.description } : null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    if (!user.accountId) throw new SessionInvalidError("Sign in with an account.");
    const result = readH3DirectorRequest(user.accountId, request.nextUrl.searchParams.get("requestId") || "");
    return NextResponse.json(result.body, {
      status: result.status, headers: { "Cache-Control": "no-store", "X-OTG-H3-Request": result.status === 202 ? "pending" : "complete" },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    if (Number(request.headers.get("content-length")) > MAX_REQUEST_LENGTH) throw new Error("H3 Director request is too large.");
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_LENGTH) throw new Error("H3 Director request is too large.");
    const body: unknown = JSON.parse(raw);
    if (!isRecord(body)) throw new Error("Enter a valid H3 Director request.");
    const instruction = cleanText(body.message || body.text);
    if (!instruction) throw new Error("Tell the H3 AI Director what to create or refine.");
    const requestKey = request.headers.get("idempotency-key") || undefined;
    if (request.headers.get("prefer") !== "respond-async") return await directShot(user, body, instruction, requestKey);

    const accountId = user.accountId;
    if (!accountId) throw new SessionInvalidError("Sign in with an account.");
    if (!requestKey) throw new Error("A request ID is required for asynchronous H3 Direct.");
    const { accepted, result } = claimH3DirectorRequest(accountId, requestKey, body, instruction);
    if (accepted) after(async () => {
      const response = await directShot(user, body, instruction, requestKey);
      finishH3DirectorRequest(accountId, requestKey, { status: response.status, body: await response.json() });
    });
    return NextResponse.json(result.body, {
      status: result.status, headers: { "Cache-Control": "no-store", "X-OTG-H3-Request": result.status === 202 ? "pending" : "complete" },
    });
  } catch (error) {
    return jsonError(error);
  }
}

async function directShot(user: Awaited<ReturnType<typeof requireSessionUser>>, body: DirectorBody, userText: string, requestKey?: string) {
  try {
    const { context, references } = await referenceContext(body, user.ownerKey);
    const visuals = await readVisualInputs(body.visualInputs, references);
    const provider = resolveReviewedAssistantProvider(body.aiProvider, user.admin);
    const permittedVisuals = provider === "local3060" || body.externalMediaConsent === true ? visuals : [];
    const conversationId = cleanText(body.conversationId, 120);
    const previous = conversationId ? getH3DirectorConversation(user.ownerKey, conversationId) : null;
    const previousPrompt = body.revision === true
      ? cleanText(body.currentPrompt) || previous?.promptVersions.at(-1)?.prompt
      : undefined;
    const shotFlow = cleanText(body.shotFlow, 120);
    const style = directorStyle(body);
    const controls = { shotFlow, styleLabel: style?.label };
    const selectedLoras = Array.isArray(body.loras) && body.loras.length
      ? validateH3LoraSelections(body.loras, context.mode, undefined, user.ownerKey).resolved.map(({ label, triggerWords }) => ({ label, triggerWords }))
      : [];
    const text = JSON.stringify({
      mode: context.mode,
      durationSeconds: context.durationSeconds,
      orientation: cleanText(body.orientation, 20),
      style,
      cameraFeel: cleanText(body.cameraFeel, 120),
      shotFlow,
      selectedReferences: references,
      ...(context.characterVoiceBindings?.length ? { characterVoiceBindings: context.characterVoiceBindings } : {}),
      selectedLoras,
      ...(previousPrompt ? { priorSceneForRequestedRevision: previousPrompt } : {}),
      userDraft: userText,
    });
    const responseSchema = { name: "h3_scene_direction", schema: h3SceneDirectionSchema(context.mode) };
    const instructions = h3SceneDirectionInstructions(context, controls);
    const result = await withAssistantProvider(provider, () => createAssistantText({
      ownerKey: user.ownerKey,
      accountId: user.accountId,
      feature: "h3-director",
      requestKey,
      useCase: "h3-director",
      model: openAIModels().h3,
      instructions,
      input: providerInput(text, permittedVisuals),
      responseSchema,
      maxOutputTokens: 1750,
      timeoutMs: 90_000,
      ...(permittedVisuals.length ? { store: false } : {}),
      ...(provider === "openai" && visuals.length && !permittedVisuals.length
        ? { localVariant: { instructions, input: providerInput(text, visuals), responseSchema } } : {}),
    }));

    const { prompt, shotCount } = compileH3SceneDirection(result.text, context, controls);
    validateH3DirectedDialogue(userText, prompt);
    const reply = `Directed ${shotCount === 1 ? "one shot" : `${shotCount} shots`} for your ${context.durationSeconds}-second clip.`;
    const conversation = upsertH3DirectorConversation({
      ownerKey: user.ownerKey,
      conversationId: previous?.id,
      userText,
      assistantText: reply,
      provider: result.provider,
      model: result.model,
      prompt,
    });

    return NextResponse.json({
      ok: true,
      prompt,
      promptFormat: H3_DIRECTED_PROMPT_FORMAT,
      reply,
      changes: [],
      conversationId: conversation.id,
      promptVersions: conversation.promptVersions,
      usage: result.usage,
      model: result.model,
      provider: result.provider,
      fallbackReason: result.fallbackReason,
      visualInputsUsed: result.provider === "local3060" ? visuals.length : permittedVisuals.length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
