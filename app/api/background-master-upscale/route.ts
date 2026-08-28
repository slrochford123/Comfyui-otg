import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OTG_BACKGROUND_MASTER_UPSCALE_V36B
//
// Background Studio Master preprocessing contract:
//
//   accepted 1280x720 candidate
//          |
//          v
//   server-side Sharp preprocessing
//          |
//          v
//      exact 480x270 PNG
//          |
//          v
//   existing verified SeedVR2 4x workflow
//          |
//          v
//      exact 1920x1080 Master
//
// This endpoint performs preprocessing only. GPU execution remains on the
// existing /api/comfy path so Background Studio does not create a parallel
// ComfyUI routing implementation.

const MASTER_SEEDVR_INPUT_WIDTH = 480;
const MASTER_SEEDVR_INPUT_HEIGHT = 270;
const MASTER_OUTPUT_WIDTH = 1920;
const MASTER_OUTPUT_HEIGHT = 1080;

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

function imageContentType(value: string) {
  return /^image\//i.test(String(value || "").trim());
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const source = formData.get("image");

    if (!(source instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Background Master preprocessing requires an image upload.",
        },
        { status: 400 },
      );
    }

    if (!source.size) {
      return NextResponse.json(
        {
          ok: false,
          error: "Background Master source image is empty.",
        },
        { status: 400 },
      );
    }

    if (source.size > MAX_SOURCE_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: "Background Master source image is too large.",
        },
        { status: 413 },
      );
    }

    if (source.type && !imageContentType(source.type)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Background Master source must be an image.",
        },
        { status: 415 },
      );
    }

    const sourceBytes = Buffer.from(await source.arrayBuffer());

    const metadata = await sharp(sourceBytes, {
      animated: false,
      failOn: "error",
    })
      .rotate()
      .metadata();

    if (!metadata.width || !metadata.height) {
      return NextResponse.json(
        {
          ok: false,
          error: "Background Master source dimensions could not be read.",
        },
        { status: 400 },
      );
    }

    const prepared = await sharp(sourceBytes, {
      animated: false,
      failOn: "error",
    })
      .rotate()
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .resize({
        width: MASTER_SEEDVR_INPUT_WIDTH,
        height: MASTER_SEEDVR_INPUT_HEIGHT,
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
      })
      .png({
        compressionLevel: 6,
        adaptiveFiltering: true,
      })
      .toBuffer();

    const output = new Uint8Array(prepared);

    return new NextResponse(output, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
        "x-otg-background-master-stage": "seedvr-input",
        "x-otg-background-master-input-width":
          String(MASTER_SEEDVR_INPUT_WIDTH),
        "x-otg-background-master-input-height":
          String(MASTER_SEEDVR_INPUT_HEIGHT),
        "x-otg-background-master-output-width":
          String(MASTER_OUTPUT_WIDTH),
        "x-otg-background-master-output-height":
          String(MASTER_OUTPUT_HEIGHT),
        "x-otg-background-master-source-width":
          String(metadata.width),
        "x-otg-background-master-source-height":
          String(metadata.height),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error?.message ||
          "Background Master preprocessing failed.",
      },
      { status: 500 },
    );
  }
}
