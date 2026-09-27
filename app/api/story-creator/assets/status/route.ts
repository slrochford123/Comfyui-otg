import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  SessionInvalidError,
} from "@/lib/ownerKey";

import {
  requireSessionUser,
} from "@/lib/sessionUser";

import {
  resolveComfyPromptImageStatus,
} from "@/lib/comfyImageOutputLookup";

import {
  completeStoryGenerationJob,
  failStoryGenerationJob,
  findStoryGenerationJobForStoryAsset,
  getStoryAsset,
  getStoryGenerationJob,
  markStoryGenerationJobRunning,
  type StoryAsset,
  type StoryGenerationJob,
} from "../../../../../lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Story asset status request failed.";

  const code =
    error &&
    typeof error === "object" &&
    "code" in error
      ? String((error as any).code || "")
      : "";

  const status =
    error instanceof SessionInvalidError
      ? 401
      : code === "STORY_PROJECT_NOT_FOUND" ||
          code === "STORY_ASSET_NOT_FOUND" ||
          code === "STORY_GENERATION_JOB_NOT_FOUND"
        ? 404
        : code === "STORY_ASSET_JOB_MISMATCH"
          ? 409
          : 400;

  return NextResponse.json(
    {
      ok: false,
      error: message,
      code,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function asRecord(value: unknown): Record<string, any> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }

  return "";
}

function completionImageUrl(args: {
  promptId: string;
  outputNodeId: string;
  filename: string;
  subfolder: string;
  type: string;
  comfyBaseUrl: string;
}) {
  const params = new URLSearchParams();
  params.set("promptId", args.promptId);
  params.set("image", "1");
  if (args.outputNodeId) params.set("nodeId", args.outputNodeId);
  params.set("filename", args.filename);
  params.set("type", args.type || "output");
  if (args.subfolder) params.set("subfolder", args.subfolder);
  if (args.comfyBaseUrl) params.set("comfyBaseUrl", args.comfyBaseUrl);

  return `/api/comfy/history-image?${params.toString()}`;
}

function jobOutputNodeId(asset: StoryAsset | null, job: StoryGenerationJob) {
  const response = asRecord(job.response);
  const metadata = asRecord(asset?.metadata);
  const imageResponse = asRecord(metadata.imageResponse);
  const completion = asRecord(metadata.completion);

  return firstText(
    response.outputNodeId,
    response.output_node_id,
    completion.outputNodeId,
    metadata.outputNodeId,
    imageResponse.outputNodeId,
    "461",
  );
}

function jobComfyBaseUrl(asset: StoryAsset | null, job: StoryGenerationJob) {
  const response = asRecord(job.response);
  const metadata = asRecord(asset?.metadata);
  const imageResponse = asRecord(metadata.imageResponse);
  const completion = asRecord(metadata.completion);

  return firstText(
    response.comfyBaseUrl,
    completion.comfyBaseUrl,
    imageResponse.comfyBaseUrl,
  );
}

function safeStatusPayload(args: {
  status: string;
  asset: StoryAsset | null;
  job: StoryGenerationJob;
  backendStatus?: string;
  temporary?: boolean;
  message?: string;
}) {
  return NextResponse.json(
    {
      ok: true,
      status: args.status,
      backendStatus: args.backendStatus || args.status,
      temporary: !!args.temporary,
      message: args.message || "",
      asset: args.asset,
      job: args.job,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json().catch(() => ({}));
    const projectId = String(body?.projectId || "").trim();
    const assetId = String(body?.assetId || "").trim();
    const jobId = String(body?.jobId || "").trim();

    let asset: StoryAsset | null = assetId
      ? getStoryAsset({
          ownerKey: user.ownerKey,
          projectId,
          assetId,
        })
      : null;

    let job = jobId
      ? getStoryGenerationJob({
          ownerKey: user.ownerKey,
          projectId,
          jobId,
        })
      : asset
        ? findStoryGenerationJobForStoryAsset({
            ownerKey: user.ownerKey,
            projectId,
            assetId: asset.id,
          })
        : null;

    if (!job) {
      throw Object.assign(
        new Error("Story asset status requires an asset or job id."),
        { code: "STORY_GENERATION_JOB_ID_REQUIRED" },
      );
    }

    if (asset && job.assetId !== asset.id) {
      throw Object.assign(
        new Error("Story generation job does not belong to this Story asset."),
        { code: "STORY_ASSET_JOB_MISMATCH" },
      );
    }

    if (!asset && job.assetId) {
      asset = getStoryAsset({
        ownerKey: user.ownerKey,
        projectId,
        assetId: job.assetId,
      });
    }

    if (job.status === "complete" || asset?.status === "ready") {
      return safeStatusPayload({
        status: "complete",
        asset,
        job,
      });
    }

    if (job.status === "failed" || asset?.status === "failed") {
      return safeStatusPayload({
        status: "failed",
        asset,
        job,
        message: job.errorText,
      });
    }

    if (!job.promptId) {
      const failed = failStoryGenerationJob({
        ownerKey: user.ownerKey,
        projectId,
        jobId: job.id,
        assetId: asset?.id,
        errorText: "Story image generation job has no Comfy prompt id.",
        response: {
          statusCheck: "missing_prompt_id",
        },
      });

      return safeStatusPayload({
        status: "failed",
        asset: failed.asset,
        job: failed.job,
        message: failed.job.errorText,
      });
    }

    const outputNodeId = jobOutputNodeId(asset, job);
    const comfyBaseUrl = jobComfyBaseUrl(asset, job);
    const resolved = await resolveComfyPromptImageStatus({
      promptId: job.promptId,
      filters: {
        nodeId: outputNodeId,
      },
      preferredBaseUrl: comfyBaseUrl,
      strictPreferred: !!comfyBaseUrl,
    });

    const statusResponse = {
      statusCheck: {
        status: resolved.status,
        attempts: resolved.attempts,
        checkedBackends: resolved.checkedBackends,
        outputCount: resolved.count,
        comfyBaseUrl: resolved.baseUrl,
      },
    };

    if (resolved.status === "completed" && resolved.image) {
      const image = resolved.image;
      const finalUrl = completionImageUrl({
        promptId: job.promptId,
        outputNodeId: image.nodeId || outputNodeId,
        filename: image.filename,
        subfolder: image.subfolder || "",
        type: image.type || "output",
        comfyBaseUrl: resolved.baseUrl || comfyBaseUrl,
      });
      const response = asRecord(job.response);
      const completed = completeStoryGenerationJob({
        ownerKey: user.ownerKey,
        projectId,
        jobId: job.id,
        assetId: asset?.id,
        response: statusResponse,
        output: {
          url: finalUrl,
          filePath: [
            image.type || "output",
            image.subfolder || "",
            image.filename,
          ].filter(Boolean).join("/"),
          promptId: job.promptId,
          outputNodeId: image.nodeId || outputNodeId,
          filename: image.filename,
          subfolder: image.subfolder || "",
          type: image.type || "output",
          comfyBaseUrl: resolved.baseUrl || comfyBaseUrl,
          backend: response.backend,
          seed: response.seed,
          width: response.width,
          height: response.height,
          provider: job.provider,
          model: response.model || job.provider,
          metadata: {
            outputCount: resolved.count,
            bucket: image.bucket || "",
          },
        },
      });

      return safeStatusPayload({
        status: "complete",
        backendStatus: resolved.status,
        asset: completed.asset,
        job: completed.job,
      });
    }

    if (
      resolved.status === "failed" ||
      resolved.status === "missing_output"
    ) {
      const failed = failStoryGenerationJob({
        ownerKey: user.ownerKey,
        projectId,
        jobId: job.id,
        assetId: asset?.id,
        errorText:
          resolved.error ||
          "Story image generation failed before producing an output.",
        response: statusResponse,
      });

      return safeStatusPayload({
        status: "failed",
        backendStatus: resolved.status,
        asset: failed.asset,
        job: failed.job,
        message: failed.job.errorText,
      });
    }

    if (resolved.status === "running") {
      const running = markStoryGenerationJobRunning({
        ownerKey: user.ownerKey,
        projectId,
        jobId: job.id,
        assetId: asset?.id,
        response: statusResponse,
      });

      return safeStatusPayload({
        status: "running",
        backendStatus: resolved.status,
        asset: running.asset,
        job: running.job,
      });
    }

    if (resolved.status === "unavailable") {
      return safeStatusPayload({
        status: job.status,
        backendStatus: resolved.status,
        temporary: true,
        asset,
        job,
        message: resolved.error,
      });
    }

    return safeStatusPayload({
      status: job.status,
      backendStatus: resolved.status,
      asset,
      job,
    });
  } catch (error) {
    return jsonError(error);
  }
}
