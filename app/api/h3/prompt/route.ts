import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { validateH3LoraSelections } from "@/lib/h3LoraCatalogServer";
import type { H3StudioReferenceDescriptor } from "@/lib/h3Studio";
import { resolveH3PromptBuilderVisualStyle } from "@/lib/h3StylePresets";
import {
  createProductionV2Scene,
  type ProductionV2GenerationMode,
} from "@/lib/production/v2";
import {
  DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS,
  H3_CAMERA_FEEL_OPTIONS,
  H3_SHOT_FLOW_OPTIONS,
  H3_VISUAL_STYLE_OPTIONS,
} from "@/lib/production/promptOptions";
import {
  H3_ORIENTATION_OPTIONS,
  H3_PRODUCTION_DURATION_OPTIONS,
  H3_QUALITY_OPTIONS,
} from "@/lib/production/h3ProductionRecipes";
import { enqueueProductionV2PromptOperation } from "@/lib/production/v2PromptOperations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES: ProductionV2GenerationMode[] = [
  "h3-text-to-video",
  "h3-image-to-video",
  "h3-reference-to-video",
];

function isH3VisualStyle(
  value: string,
): value is (typeof H3_VISUAL_STYLE_OPTIONS)[number] {
  return (H3_VISUAL_STYLE_OPTIONS as readonly string[]).includes(value);
}

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) },
  });
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const body = (await req.json().catch(() => null)) as Record<
      string,
      any
    > | null;
    if (!body) throw new Error("A valid H3 prompt request is required.");
    const mode = String(body?.mode || "") as ProductionV2GenerationMode;
    const durationSeconds = Number(body?.durationSeconds);
    const quality = String(body?.quality || "");
    const orientation = String(body?.orientation || "");
    const originalPrompt = String(body?.originalPrompt || "").trim();
    if (!MODES.includes(mode))
      throw new Error("Choose Text, Image, or Reference mode.");
    if (!H3_PRODUCTION_DURATION_OPTIONS.includes(durationSeconds as 5 | 10))
      throw new Error("Choose a 5- or 10-second duration.");
    if (!H3_QUALITY_OPTIONS.includes(quality as "lq" | "hq"))
      throw new Error("Choose LQ or HQ.");
    if (!H3_ORIENTATION_OPTIONS.includes(orientation as "landscape" | "portrait"))
      throw new Error("Choose Landscape or Portrait orientation.");
    if (!originalPrompt)
      throw new Error("Write your scene before using Prompt Builder.");

    const requestedVisualStyle = H3_VISUAL_STYLE_OPTIONS.includes(
      body?.visualStyle,
    )
      ? body.visualStyle
      : DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.visualStyle;

    const promptBuilderVisualStyle = resolveH3PromptBuilderVisualStyle(
      body?.stylePresetId,
      requestedVisualStyle,
    );

    if (!isH3VisualStyle(promptBuilderVisualStyle))
      throw new Error(
        "Selected H3 style preset has an invalid Prompt Builder visual style.",
      );

    const optionalLoras = validateH3LoraSelections(
      body?.loras,
      mode as any,
    ).resolved;
    const references = Array.isArray(body?.references)
      ? (body.references as H3StudioReferenceDescriptor[])
      : [];
    const referenceLines = references.map(
      (item, index) =>
        `${item.kind} reference ${index + 1}: ${String(item.description || item.name).trim()}${item.kind === "video" && item.includeAudio ? "; use its audio" : ""}`,
    );
    const loraLines = optionalLoras.map(
      (item) =>
        `Optional H3 LoRA: ${item.label}, strength ${item.strength}${item.triggerWords.length ? `, trigger words ${item.triggerWords.join(", ")}` : ""}`,
    );
    const augmentedRequest = [
      originalPrompt,
      `Output orientation: ${orientation}.`,
      ...referenceLines,
      ...loraLines,
    ]
      .filter(Boolean)
      .join("\n");

    const scene = createProductionV2Scene(1, "minimax-h3");
    scene.generationMode = mode;
    scene.durationSeconds = durationSeconds as 5 | 10;
    scene.h3Quality = quality as "lq" | "hq";
    scene.promptOptions = {
      ...DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS,
      visualStyle: promptBuilderVisualStyle,
      cameraFeel: H3_CAMERA_FEEL_OPTIONS.includes(body?.cameraFeel)
        ? body.cameraFeel
        : DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.cameraFeel,
      shotFlow: H3_SHOT_FLOW_OPTIONS.includes(body?.shotFlow)
        ? body.shotFlow
        : DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.shotFlow,
    };
    scene.promptStateByMode[mode] = {
      ...scene.promptStateByMode[mode],
      userPrompt: augmentedRequest,
    };

    if (mode === "h3-image-to-video") {
      const name = String(body?.firstImageName || "First Image").trim();
      scene.modelState.h3.imageToVideo.startingImage = {
        id: "h3-studio-first-image",
        sourceKind: "production-upload",
        sourceId: "h3-studio-first-image",
        name,
        identityDescription: `The authoritative first image named ${name}.`,
        workflowImage: name,
        generationSourceType: "production-upload",
      };
    }
    if (mode === "h3-reference-to-video") {
      scene.selectedAssets = references
        .filter((item) => item.kind === "image")
        .map((item, index) => ({
          assetId: `h3-studio-reference-${index + 1}`,
          snapshotName: item.name || `Reference ${index + 1}`,
          defaultImageRef: {
            displayImage: item.name,
            workflowImage: item.name,
          },
          identityDescription: item.description || item.name,
        }));
    }

    const operation = enqueueProductionV2PromptOperation(owner.ownerKey, scene);
    const pollUrl = `/api/production/v2/prompt/${encodeURIComponent(operation.id)}`;
    return noStore(
      {
        ok: true,
        operationId: operation.id,
        status: operation.status,
        statusMessage: operation.statusMessage,
        pollUrl,
      },
      { status: 202, headers: { Location: pollUrl, "Retry-After": "1" } },
    );
  } catch (error) {
    if (error instanceof SessionInvalidError)
      return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    return noStore(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
