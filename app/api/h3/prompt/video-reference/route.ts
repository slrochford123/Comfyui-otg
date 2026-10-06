import fsp from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  H3_REFERENCE_VIDEO_CLIP_SECONDS,
  extractH3ReferenceVideoPromptFrame,
} from "@/lib/h3ReferenceVideoClip";
import {
  readCompletedH3StagedUpload,
} from "@/lib/h3StagedUploads";
import {
  getOwnerContext,
  SessionInvalidError,
} from "@/lib/ownerKey";
import {
  OTG_DATA_ROOT,
  safeJoin,
  safeSegment,
} from "@/lib/paths";
import {
  qwenDurableFetch,
} from "@/lib/workers/qwenDurableFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const H3_VIDEO_REFERENCE_VISION_MODEL =
  String(
    process.env.H3_VIDEO_REFERENCE_VISION_MODEL
    || process.env.PRODUCTION_V2_VISION_ENHANCE_MODEL
    || "redule26/huihui_ai_qwen2.5-vl-7b-abliterated:latest",
  ).trim();

function noStore(
  payload: unknown,
  init?: ResponseInit,
) {
  return NextResponse.json(
    payload,
    {
      ...init,
      headers: {
        "Cache-Control": "private, no-store",
        ...(init?.headers || {}),
      },
    },
  );
}

function finiteNumber(
  value: unknown,
  fallback = 0,
) {
  const next =
    Number(
      value,
    );

  return Number.isFinite(
    next,
  )
    ? next
    : fallback;
}

function cleanText(
  value: unknown,
  maxLength = 240,
) {
  return String(
    value || "",
  )
    .replace(
      /\r/g,
      " ",
    )
    .replace(
      /\n+/g,
      " ",
    )
    .replace(
      /\s+/g,
      " ",
    )
    .replace(
      /^["'`\s]+|["'`\s]+$/g,
      "",
    )
    .trim()
    .slice(
      0,
      maxLength,
    );
}

async function describeFrame(
  framePath: string,
  referenceName: string,
  startSeconds: number,
  ownerKey: string,
) {
  const bytes =
    await fsp.readFile(
      framePath,
    );

  const prompt =
    [
      "/no_think",
      "",
      "You are a factual visual observer supporting the MiniMax H3 Reference-to-Video Prompt Builder.",
      "Inspect exactly ONE supplied video frame.",
      "This frame is the first frame of the selected five-second video reference window.",
      "Describe only visible factual information useful for an AI video prompt: subject identity cues, shot composition, camera angle, environment, props, lighting, color palette, and any motion setup implied by visible posture or blur.",
      "Do not invent unseen actions, dialogue, events, off-screen objects, or story facts.",
      "Return one concise factual paragraph only. No markdown, labels, JSON, preamble, or analysis.",
      "",
      `Reference video: ${referenceName || "Unnamed video reference"}.`,
      `Selected window starts at ${startSeconds.toFixed(2)} seconds and lasts ${H3_REFERENCE_VIDEO_CLIP_SECONDS} seconds.`,
    ].join(
      "\n",
    );

  const response =
    await qwenDurableFetch(
      "/api/generate",
      {
        stream: false,
        prompt,
        images: [
          bytes.toString(
            "base64",
          ),
        ],
        options: {
          temperature: 0.1,
          top_p: 0.8,
          repeat_penalty: 1.05,
          num_predict: 180,
          num_ctx: 4096,
        },
      },
      {
        requiredContextTokens: 4096,
        timeoutMs: 120_000,
        allowedNodes: [
          "slr",
        ],
        model:
          H3_VIDEO_REFERENCE_VISION_MODEL,
        keepAlive: 0,
        leaseTtlSeconds: 180,
        ownerKey,
        requestKind:
          "h3-video-reference-prompt-frame",
      },
    );

  const raw =
    await response.text();

  let payload: any = null;

  try {
    payload =
      raw
        ? JSON.parse(
            raw,
          )
        : {};
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      cleanText(
        payload?.error
        || raw
        || `Video reference frame analysis failed with status ${response.status}.`,
        500,
      ),
    );
  }

  const descriptor =
    cleanText(
      payload?.response,
      900,
    );

  if (!descriptor) {
    throw new Error(
      "Video reference frame analysis returned no description.",
    );
  }

  return descriptor;
}

export async function POST(
  request: NextRequest,
) {
  let frameDir = "";

  try {
    const owner =
      await getOwnerContext(
        request,
      );

    const body =
      await request.json()
        .catch(
          () => null,
        ) as Record<string, unknown> | null;

    if (
      !body
      || typeof body !== "object"
    ) {
      throw new Error(
        "A valid H3 video reference prompt request is required.",
      );
    }

    const staged =
      await readCompletedH3StagedUpload(
        owner.ownerKey,
        body.reference,
        "video",
      );

    const startSeconds =
      finiteNumber(
        body.clipStartSeconds,
        0,
      );

    const requestId =
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    frameDir =
      safeJoin(
        OTG_DATA_ROOT,
        "h3-direct",
        safeSegment(
          owner.ownerKey,
        ),
        "prompt-builder-frames",
        safeSegment(
          requestId,
        ),
      );

    const frame =
      await extractH3ReferenceVideoPromptFrame(
        {
          inputPath:
            staged.path,
          outputDir:
            frameDir,
          outputPrefix:
            path.parse(
              staged.name,
            ).name || "video-reference",
          startSeconds,
        },
      );

    const descriptor =
      await describeFrame(
        frame.outputPath,
        cleanText(
          body.name
          || staged.name,
          180,
        ),
        frame.startSeconds,
        owner.ownerKey,
      );

    return noStore(
      {
        ok: true,
        descriptor,
        name:
          staged.name,
        frame: {
          startSeconds:
            frame.startSeconds,
          durationSeconds:
            frame.durationSeconds,
          sourceDurationSeconds:
            frame.sourceDurationSeconds,
        },
      },
    );
  } catch (error) {
    if (
      error
      instanceof SessionInvalidError
    ) {
      return noStore(
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

    return noStore(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not describe the H3 video reference frame.",
      },
      {
        status: 400,
      },
    );
  } finally {
    if (frameDir) {
      await fsp.rm(
        frameDir,
        {
          recursive: true,
          force: true,
        },
      ).catch(
        () => undefined,
      );
    }
  }
}
