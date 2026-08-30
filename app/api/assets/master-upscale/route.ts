import {
  NextRequest,
  NextResponse,
} from "next/server";
import sharp from "sharp";

import {
  getOwnerContext,
  SessionInvalidError,
} from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Asset Master contract:
//
// source candidate
//      |
//      v
// exact 270x270 transparent PNG
//      |
//      v
// existing verified SeedVR2 4x workflow
//      |
//      v
// exact 1080x1080 canonical Asset master
//
// GPU execution remains on /api/comfy. This endpoint performs
// deterministic source preparation only.

const ASSET_SEEDVR_INPUT_SIZE =
  270;

const ASSET_MASTER_OUTPUT_SIZE =
  1080;

const MAX_SOURCE_BYTES =
  50 * 1024 * 1024;

function noStoreJson(
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

export async function POST(
  request: NextRequest,
) {
  try {
    const bodyRequest =
      request.clone();

    await getOwnerContext(
      request,
    );

    const form =
      await bodyRequest.formData();

    const source =
      form.get("image");

    if (
      !(source instanceof File)
    ) {
      return noStoreJson(
        {
          ok: false,
          error:
            "Asset Master preprocessing requires an image upload.",
        },
        {
          status: 400,
        },
      );
    }

    if (!source.size) {
      return noStoreJson(
        {
          ok: false,
          error:
            "Asset Master source image is empty.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      source.size >
      MAX_SOURCE_BYTES
    ) {
      return noStoreJson(
        {
          ok: false,
          error:
            "Asset Master source image is too large.",
        },
        {
          status: 413,
        },
      );
    }

    if (
      source.type &&
      !/^image\//i.test(
        source.type,
      )
    ) {
      return noStoreJson(
        {
          ok: false,
          error:
            "Asset Master source must be an image.",
        },
        {
          status: 415,
        },
      );
    }

    const sourceBytes =
      Buffer.from(
        await source.arrayBuffer(),
      );

    const metadata =
      await sharp(
        sourceBytes,
        {
          animated: false,
          failOn: "error",
        },
      )
        .rotate()
        .metadata();

    if (
      !metadata.width ||
      !metadata.height
    ) {
      return noStoreJson(
        {
          ok: false,
          error:
            "Asset Master source dimensions could not be read.",
        },
        {
          status: 400,
        },
      );
    }

    const prepared =
      await sharp(
        sourceBytes,
        {
          animated: false,
          failOn: "error",
        },
      )
        .rotate()
        .ensureAlpha()
        .resize({
          width:
            ASSET_SEEDVR_INPUT_SIZE,
          height:
            ASSET_SEEDVR_INPUT_SIZE,
          fit: "contain",
          position:
            "centre",
          background: {
            r: 0,
            g: 0,
            b: 0,
            alpha: 0,
          },
          kernel:
            sharp.kernel.lanczos3,
        })
        .png({
          compressionLevel: 6,
          adaptiveFiltering:
            true,
        })
        .toBuffer();

    return new NextResponse(
      new Uint8Array(
        prepared,
      ),
      {
        status: 200,
        headers: {
          "content-type":
            "image/png",
          "cache-control":
            "private, no-store",
          "x-otg-asset-master-stage":
            "seedvr-input",
          "x-otg-asset-master-engine":
            "SeedVR2",
          "x-otg-asset-master-input-width":
            String(
              ASSET_SEEDVR_INPUT_SIZE,
            ),
          "x-otg-asset-master-input-height":
            String(
              ASSET_SEEDVR_INPUT_SIZE,
            ),
          "x-otg-asset-master-output-width":
            String(
              ASSET_MASTER_OUTPUT_SIZE,
            ),
          "x-otg-asset-master-output-height":
            String(
              ASSET_MASTER_OUTPUT_SIZE,
            ),
          "x-otg-asset-master-source-width":
            String(
              metadata.width,
            ),
          "x-otg-asset-master-source-height":
            String(
              metadata.height,
            ),
        },
      },
    );
  } catch (error) {
    if (
      error instanceof
      SessionInvalidError
    ) {
      return noStoreJson(
        {
          ok: false,
          error:
            "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    return noStoreJson(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Asset Master preprocessing failed.",
      },
      {
        status: 500,
      },
    );
  }
}
