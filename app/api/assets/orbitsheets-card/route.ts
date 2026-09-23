import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { submitComfyPromptWith5060Lease } from "@/lib/workers/comfyPromptLease";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ComfyOutput = {
  filename: string;
  subfolder: string;
  type: string;
};

type H3CardBackend = "rtx5060ti" | "rtx3090";

function asString(value: unknown) {
  return String(value || "").trim();
}

function comfyBaseUrl(backend: H3CardBackend = "rtx5060ti") {
  if (backend === "rtx3090") {
    return String(
      process.env.OTG_H3_CARD_COMFY_BACKUP_BASE_URL ||
        process.env.OTG_VIDEO_PRIMARY_COMFY_URL ||
        "http://100.75.162.64:8188",
    )
      .trim()
      .replace(/\/+$/, "");
  }

  return String(
    process.env.OTG_H3_CARD_COMFY_BASE_URL ||
      process.env.COMFYUI_IMAGE_URL ||
      "http://192.168.1.113:8188",
  )
    .trim()
    .replace(/\/+$/, "");
}

function workflowPath() {
  return path.join(
    process.cwd(),
    "comfy_workflows",
    "card_builder",
    "asset_card.api.json",
  );
}

function applyAssetFrameSelectionGuidance(workflow: any) {
  const selector = workflow?.["164"];
  if (
    !selector ||
    selector.class_type !== "H3LookSheetsSelectFrames"
  ) {
    throw new Error(
      "H3 Asset Card workflow is missing expected H3LookSheetsSelectFrames node 164.",
    );
  }

  selector.inputs.saved_frame_count = 6;
  selector.inputs.tier1_shots_clusters = 6;
  selector.inputs.tier2_prompt_how_to_select_frames =
    "Select exactly six clear neutral product-reference views of the same asset: front, back, left side, right side, top looking down, and bottom looking up. Prefer sharp, well-exposed frames with the full object visible and centered. Reject motion blur, occlusion, heavy cropping, face/expression language, and near-duplicate angles.";
}

async function comfyJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
  });

  const text = await response.text();
  let json: any = null;

  try {
    json = JSON.parse(text);
  } catch {}

  if (!response.ok) {
    throw new Error(
      json?.error?.message ||
        json?.error ||
        text ||
        `ComfyUI request failed (${response.status})`,
    );
  }

  return json;
}

async function uploadSourceToBackend(
  sourcePath: string,
  baseUrl: string,
) {
  const bytes = await fs.readFile(sourcePath);
  const originalName = path.basename(sourcePath);
  const extension = path.extname(originalName) || ".png";
  const stem =
    path
      .basename(originalName, path.extname(originalName))
      .replace(/[^a-zA-Z0-9._-]/g, "_") || "asset";

  const uploadName = `otg-asset-card-${Date.now()}-${stem}${extension}`;

  const form = new FormData();
  form.append(
    "image",
    new Blob([new Uint8Array(bytes)]),
    uploadName,
  );
  form.append("overwrite", "true");

  const response = await fetch(
    `${baseUrl}/upload/image`,
    {
      method: "POST",
      body: form,
      cache: "no-store",
    },
  );

  const text = await response.text();
  let json: any = null;

  try {
    json = JSON.parse(text);
  } catch {}

  if (!response.ok) {
    throw new Error(
      `ComfyUI image upload failed (${response.status}): ${text}`,
    );
  }

  const name = asString(json?.name || json?.filename);
  const subfolder = asString(json?.subfolder);

  if (!name) {
    throw new Error(
      `5060 ComfyUI upload returned no filename: ${text}`,
    );
  }

  return subfolder ? `${subfolder}/${name}` : name;
}

function firstOutput(
  result: any,
  nodeId: string,
): ComfyOutput | null {
  const files = Array.isArray(result?.outputs?.[nodeId]?.images)
    ? result.outputs[nodeId].images
    : [];

  for (const file of files) {
    const filename = asString(file?.filename);
    if (!filename) continue;

    return {
      filename,
      subfolder: asString(file?.subfolder),
      type: asString(file?.type) || "output",
    };
  }

  return null;
}

async function waitForOutputs(
  promptId: string,
  baseUrl: string,
) {
  const deadline = Date.now() + 10 * 60 * 1000;

  while (Date.now() < deadline) {
    const history = await comfyJson(
      `${baseUrl}/history/${encodeURIComponent(promptId)}`,
    );

    const result = history?.[promptId];

    if (result) {
      const status = result?.status;

      if (status?.status_str === "error") {
        throw new Error(
          `H3 Asset Card failed: ${JSON.stringify(status)}`,
        );
      }

      const image = firstOutput(result, "70");
      const video = firstOutput(result, "79");

      if (image && video) {
        return {
          image,
          video,
          description: asString(
            result?.outputs?.["141"]?.text?.[0],
          ),
          prompt: asString(
            result?.outputs?.["136"]?.text?.[0],
          ),
        };
      }

      if (status?.completed === true) {
        throw new Error(
          "H3 Asset Card completed without both node 70 PNG and node 79 MP4 outputs.",
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error(
    `H3 Asset Card timed out waiting for prompt ${promptId}`,
  );
}

function proxyUrl(
  output: ComfyOutput,
  kind: "image" | "video",
  backend: H3CardBackend,
) {
  const params = new URLSearchParams({
    kind,
    filename: output.filename,
    subfolder: output.subfolder,
    type: output.type,
    backend,
  });

  return `/api/assets/orbitsheets-card?${params.toString()}`;
}

export async function GET(request: NextRequest) {
  try {
    const filename = asString(
      request.nextUrl.searchParams.get("filename"),
    );
    const subfolder = asString(
      request.nextUrl.searchParams.get("subfolder"),
    );
    const type =
      asString(request.nextUrl.searchParams.get("type")) ||
      "output";
    const kind =
      request.nextUrl.searchParams.get("kind") === "video"
        ? "video"
        : "image";

    if (!filename || path.basename(filename) !== filename) {
      return NextResponse.json(
        { ok: false, error: "Invalid filename." },
        { status: 400 },
      );
    }

    const backend =
      request.nextUrl.searchParams.get("backend") === "rtx3090"
        ? "rtx3090"
        : "rtx5060ti";
    const viewUrl = new URL(`${comfyBaseUrl(backend)}/view`);
    viewUrl.searchParams.set("filename", filename);
    viewUrl.searchParams.set("type", type);

    if (subfolder) {
      viewUrl.searchParams.set("subfolder", subfolder);
    }

    const response = await fetch(viewUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `ComfyUI output fetch failed (${response.status}).`,
        },
        { status: 502 },
      );
    }

    const bytes = await response.arrayBuffer();

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ||
          (kind === "video" ? "video/mp4" : "image/png"),
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[h3-asset-card-view]", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "H3 Asset Card output fetch failed.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.formData();

    const sourceServerPath = asString(
      body.get("sourceServerPath"),
    );

    if (!sourceServerPath) {
      return NextResponse.json(
        {
          ok: false,
          error: "sourceServerPath is required.",
        },
        { status: 400 },
      );
    }

    const source = path.resolve(sourceServerPath);
    await fs.access(source);

    const rawWorkflow = await fs.readFile(
      workflowPath(),
      "utf8",
    );

    const workflow = JSON.parse(rawWorkflow);

    if (
      !workflow?.["81"] ||
      workflow["81"].class_type !== "LoadImage"
    ) {
      throw new Error(
        "H3 Asset Card workflow is missing expected LoadImage node 81.",
      );
    }

    if (
      !workflow?.["143"] ||
      workflow["143"].class_type !== "OTGH3CardDescribe"
    ) {
      throw new Error(
        "H3 Asset Card workflow is missing expected OTGH3CardDescribe node 143.",
      );
    }

    if (
      !workflow?.["189"] ||
      workflow["189"].class_type !== "OTGH3CardPrompt"
    ) {
      throw new Error(
        "H3 Asset Card workflow is missing expected OTGH3CardPrompt node 189.",
      );
    }

    applyAssetFrameSelectionGuidance(workflow);

    async function submitOnBackend(backend: H3CardBackend) {
      const baseUrl = comfyBaseUrl(backend);
      const backendWorkflow = JSON.parse(JSON.stringify(workflow));
      const uploadedName =
        await uploadSourceToBackend(source, baseUrl);

      backendWorkflow["81"].inputs.image = uploadedName;

      const submissionResponse =
        await submitComfyPromptWith5060Lease({
          baseUrl,
          workerId: `api-asset-h3-card-${backend}`,
          init: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              prompt: backendWorkflow,
              client_id: `otg-asset-h3-card-${backend}-${Date.now()}`,
            }),
          },
        });

      const submissionText =
        await submissionResponse.text();

      let submission: any = null;

      try {
        submission = JSON.parse(submissionText);
      } catch {}

      if (!submissionResponse.ok) {
        throw new Error(
          submission?.error?.message ||
            submission?.error ||
            submissionText ||
            `ComfyUI /prompt failed (${submissionResponse.status}).`,
        );
      }

      const promptId = asString(
        submission?.prompt_id || submission?.promptId,
      );

      if (!promptId) {
        throw new Error(
          "H3 Asset Card did not return a ComfyUI prompt id.",
        );
      }

      return { backend, baseUrl, promptId };
    }

    let submission:
      | { backend: H3CardBackend; baseUrl: string; promptId: string }
      | null = null;

    try {
      submission = await submitOnBackend("rtx5060ti");
    } catch (primaryError) {
      console.warn(
        "[h3-asset-card] RTX 5060 Ti primary submission failed; trying RTX 3090 backup.",
        primaryError,
      );
      submission = await submitOnBackend("rtx3090");
    }

    const { backend, baseUrl, promptId } = submission;
    const result = await waitForOutputs(promptId, baseUrl);
    const serverScheme =
      backend === "rtx5060ti" ? "comfy5060" : "comfy3090";

    return NextResponse.json({
      ok: true,
      engine: "orbitsheets-h3",
      promptId,
      backend,

      url: proxyUrl(result.image, "image", backend),
      serverPath: `${serverScheme}://output/${result.image.subfolder}/${result.image.filename}`,
      filename: result.image.filename,
      sourceName: result.image.filename,

      videoUrl: proxyUrl(result.video, "video", backend),
      videoServerPath: `${serverScheme}://output/${result.video.subfolder}/${result.video.filename}`,
      videoFilename: result.video.filename,
      videoSourceName: result.video.filename,

      generatedDescription: result.description,
      generatedPrompt: result.prompt,
      workflow: "asset_card.api.json",
    });
  } catch (error) {
    console.error("[h3-asset-card]", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "H3 Asset Card failed.",
      },
      { status: 500 },
    );
  }
}
