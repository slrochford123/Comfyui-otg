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
  getProductionV2PromptOperation,
  kickProductionV2PromptOperationScheduler,
} from "@/lib/production/v2PromptOperations";

/*
 * OTG_PRODUCTION_V2_ASYNC_PROMPT_POLL_V1
 *
 * Polling never performs inference directly.
 *
 * It reads persisted operation state and also nudges the durable
 * orchestrator so polling remains self-healing after dev reloads
 * or other non-production process lifecycle events.
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

export async function GET(
  req: NextRequest,
  context: {
    params:
      Promise<{
        operationId: string;
      }>;
  },
) {
  if (
    !isProductionFeatureEnabled()
  ) {
    return productionDisabledResponse();
  }

  try {
    const owner =
      await getOwnerContext(
        req,
      );

    const {
      operationId,
    } =
      await context.params;

    const operation =
      getProductionV2PromptOperation(
        String(
          operationId
          || "",
        ),
      );

    /*
     * Return the same not-found response for unknown and
     * differently-owned operations.
     */
    if (
      !operation
      || operation.ownerKey
        !== owner.ownerKey
    ) {
      return noStore(
        {
          ok:
            false,

          error:
            "Scene Prompt operation not found.",
        },
        {
          status:
            404,
        },
      );
    }

    if (
      operation.status
      !== "completed"
      && operation.status
        !== "failed"
    ) {
      kickProductionV2PromptOperationScheduler();
    }

    return noStore({
      ok:
        true,

      operationId:
        operation.id,

      status:
        operation.status,

      statusMessage:
        operation.statusMessage,

      result:
        operation.status
          === "completed"
          ? operation.result
          : null,

      error:
        operation.status
          === "failed"
          ? (
              operation.error
              || "Scene Prompt generation failed."
            )
          : null,
    });
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
            || "Could not read the Scene Prompt operation.",
          )
        : "Could not read the Scene Prompt operation.";

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
