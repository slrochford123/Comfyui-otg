import type {
  NextRequest,
} from "next/server";

import {
  NextResponse,
} from "next/server";

import {
  getOwnerContext,
  SessionInvalidError,
} from "@/lib/ownerKey";

import {
  isProductionFeatureEnabled,
  productionDisabledResponse,
} from "@/lib/production/featureGate";

import {
  buildLtx25IngredientsManifest,
} from "@/lib/production/ltx25IngredientsManifest";

import {
  resolveProductionV2H3ReferencePlan,
} from "@/lib/production/referenceResolver";

import {
  normalizeProductionV2,
  type ProductionV2Model,
  type ProductionV2Scene,
} from "@/lib/production/v2";

import {
  enqueueProductionV2PromptOperation,
} from "@/lib/production/v2PromptOperations";

/*
 * OTG_PRODUCTION_V2_ASYNC_PROMPT_API_V1
 *
 * POST performs validation and durable operation persistence only.
 *
 * GPU availability never holds this HTTP request open.
 * Qwen work continues through the durable prompt operation scheduler.
 */

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

function noStore(
  payload: unknown,
  init?: ResponseInit,
) {
  return NextResponse.json(
    payload,
    {
      ...init,

      headers: {
        "Cache-Control":
          "private, no-store",

        ...(init?.headers || {}),
      },
    },
  );
}

function normalizeScene(
  value: unknown,
): ProductionV2Scene {
  const raw =
    value as
      Partial<ProductionV2Scene>
      | null;

  const defaultModel:
    ProductionV2Model =
      raw?.model === "ltx-2.5"
        ? "ltx-2.5"
        : "minimax-h3";

  return normalizeProductionV2({
    schemaVersion:
      2,

    id:
      "production-prompt-request",

    name:
      "Production Prompt Request",

    status:
      "draft",

    defaultModel,

    scenes: [
      raw,
    ],
  }).scenes[0];
}

export async function POST(
  req: NextRequest,
) {
  if (
    !isProductionFeatureEnabled()
  ) {
    return productionDisabledResponse();
  }

  try {
    const body =
      await req
        .json()
        .catch(
          () => null,
        ) as {
          scene?: unknown;
        }
        | null;

    const owner =
      await getOwnerContext(
        req,
      );

    if (!body?.scene) {
      return noStore(
        {
          ok:
            false,

          error:
            "A Production V2 scene is required.",
        },
        {
          status:
            400,
        },
      );
    }

    let scene =
      normalizeScene(
        body.scene,
      );

    if (
      !(
        scene.model
        === "minimax-h3"
        || (
          scene.model
          === "ltx-2.5"
          && scene.generationMode
          === "ltx-ingredients-image-to-video"
        )
      )
    ) {
      return noStore(
        {
          ok:
            false,

          error:
            "The Production V2 prompt builder does not support this model/generation-mode combination.",
        },
        {
          status:
            400,
        },
      );
    }

    if (
      scene.model
      === "minimax-h3"
      && scene.generationMode
      === "h3-reference-to-video"
    ) {
      scene =
        resolveProductionV2H3ReferencePlan(
          scene,
        );
    }

    /*
     * OTG_PRODUCTION_V2_LTX_PROMPT_API_V1
     *
     * Validate the canonical LTX Ingredients manifest server-side
     * before creating the durable prompt operation.
     *
     * This does not compose the Ingredients sheet and does not run
     * Qwen. It only validates the selected canonical references.
     */
    if (
      scene.model
      === "ltx-2.5"
      && scene.generationMode
      === "ltx-ingredients-image-to-video"
    ) {
      try {
        buildLtx25IngredientsManifest(
          scene,
        );
      } catch (error) {
        return noStore(
          {
            ok:
              false,

            error:
              error instanceof Error
                ? error.message
                : String(error),
          },
          {
            status:
              400,
          },
        );
      }
    }

    const operation =
      enqueueProductionV2PromptOperation(
        owner.ownerKey,
        scene,
      );

    const pollUrl =
      `/api/production/v2/prompt/${encodeURIComponent(operation.id)}`;

    return noStore(
      {
        ok:
          true,

        operationId:
          operation.id,

        status:
          operation.status,

        statusMessage:
          operation.statusMessage,

        pollUrl,
      },
      {
        status:
          202,

        headers: {
          Location:
            pollUrl,

          "Retry-After":
            "1",
        },
      },
    );
  } catch (error) {
    if (
      error instanceof
        SessionInvalidError
    ) {
      return noStore(
        {
          ok:
            false,

          error:
            "Unauthorized",
        },
        {
          status:
            401,
        },
      );
    }

    const message =
      error
      && typeof error === "object"
      && "message" in error
        ? String(
            (
              error as {
                message?: unknown;
              }
            ).message
            || "Could not queue the Production Scene Prompt.",
          )
        : "Could not queue the Production Scene Prompt.";

    return noStore(
      {
        ok:
          false,

        error:
          message,
      },
      {
        status:
          500,
      },
    );
  }
}
