import fs from "node:fs/promises";
import path from "node:path";
import { randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { submitComfyPromptWith5060Lease } from "@/lib/workers/comfyPromptLease";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ComfyOutput = {
  filename: string;
  subfolder: string;
  type: string;
};

type CardBackend = "rtx5060ti" | "rtx3090";

function asString(value: unknown) {
  return String(value || "").trim();
}

function comfyBaseUrl(backend: CardBackend = "rtx5060ti") {
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
    "qwen21_asset_card.api.json",
  );
}

function assetCardPrompt() {
  return (
    "Use <image1> as the exact asset reference. " +
    "Create one professional 1920x1080 landscape six-view asset card of the SAME object with exactly these views arranged cleanly in a 3x2 sheet: LEFT side, RIGHT side, FRONT, BACK, low underside view looking up, and top-down view looking down. " +
    "Preserve the exact object identity, silhouette, proportions, materials, colors, markings, wear, labels that are physically part of the object, surface finish, and all distinctive construction details across every view. " +
    "Keep neutral studio lighting, consistent scale, consistent design, centered full-object views, and a clean light-gray studio background. " +
    "Infer unseen sides only as necessary and keep them consistent with the source. " +
    "No scene context, no hands, no extra objects, no decorative props, no generated captions, no added labels, no watermarks."
  );
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
  const sourceBytes = await fs.readFile(sourcePath);
  const bytes = await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 3,
      background: "#d9d9d9",
    },
  })
    .composite([
      {
        input: await sharp(sourceBytes, {
          animated: false,
          failOn: "none",
          limitInputPixels: false,
        })
          .rotate()
          .resize({
            width: 900,
            height: 820,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png()
          .toBuffer(),
        left: 510,
        top: 130,
      },
    ])
    .png()
    .toBuffer();
  const originalName = path.basename(sourcePath);
  const stem =
    path
      .basename(originalName, path.extname(originalName))
      .replace(/[^a-zA-Z0-9._-]/g, "_") || "asset";

  const uploadName = `otg-qwen21-asset-card-canvas-${Date.now()}-${stem}.png`;

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
          `Qwen Image Edit 2.1 Asset Card failed: ${JSON.stringify(status)}`,
        );
      }

      const image = firstOutput(result, "461");

      if (image) {
        return {
          image,
        };
      }

      if (status?.completed === true) {
        throw new Error(
          "Qwen Image Edit 2.1 Asset Card completed without node 461 PNG output.",
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error(
    `Qwen Image Edit 2.1 Asset Card timed out waiting for prompt ${promptId}`,
  );
}

function proxyUrl(
  output: ComfyOutput,
  kind: "image" | "video",
  backend: CardBackend,
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
    console.error("[qwen21-asset-card-view]", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Qwen Image Edit 2.1 Asset Card output fetch failed.",
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
      !workflow?.["470"] ||
      workflow["470"].class_type !== "LoadImage"
    ) {
      throw new Error(
        "Qwen Asset Card workflow is missing expected LoadImage node 470.",
      );
    }

    if (
      !workflow?.["474"] ||
      workflow["474"].class_type !== "TextEncodeQwenImage21"
    ) {
      throw new Error(
        "Qwen Asset Card workflow is missing expected TextEncodeQwenImage21 node 474.",
      );
    }

    if (
      !workflow?.["458"] ||
      workflow["458"].class_type !== "KSampler"
    ) {
      throw new Error(
        "Qwen Asset Card workflow is missing expected KSampler node 458.",
      );
    }

    if (
      !workflow?.["461"] ||
      workflow["461"].class_type !== "SaveImageAdvanced"
    ) {
      throw new Error(
        "Qwen Asset Card workflow is missing expected SaveImageAdvanced node 461.",
      );
    }

    workflow["474"].inputs.prompt = assetCardPrompt();
    workflow["474"].inputs.negative_prompt =
      "different object, redesigned asset, inconsistent proportions, inconsistent colors, duplicate object, multiple objects, blurry, low quality, cropped view, cut off object, person, hands, text, captions, generated labels, watermark, logo, signature, decorative border";
    workflow["474"].inputs.resolution = 0;
    workflow["458"].inputs.seed = randomInt(1, 1_000_000_000);

    async function submitOnBackend(backend: CardBackend) {
      const baseUrl = comfyBaseUrl(backend);
      const backendWorkflow = JSON.parse(JSON.stringify(workflow));
      const uploadedName =
        await uploadSourceToBackend(source, baseUrl);

      backendWorkflow["470"].inputs.image = uploadedName;

      const submissionResponse =
        await submitComfyPromptWith5060Lease({
          baseUrl,
          workerId: `api-asset-qwen21-card-${backend}`,
          init: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              prompt: backendWorkflow,
              client_id: `otg-asset-qwen21-card-${backend}-${Date.now()}`,
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
          "Qwen Image Edit 2.1 Asset Card did not return a ComfyUI prompt id.",
        );
      }

      return { backend, baseUrl, promptId };
    }

    let submission:
      | { backend: CardBackend; baseUrl: string; promptId: string }
      | null = null;

    try {
      submission = await submitOnBackend("rtx5060ti");
    } catch (primaryError) {
      console.warn(
        "[qwen21-asset-card] RTX 5060 Ti primary submission failed; trying RTX 3090 backup.",
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
      engine: "qwen-image-edit-2.1",
      cardEngine: "qwen-image-edit-2.1",
      promptId,
      backend,

      url: proxyUrl(result.image, "image", backend),
      serverPath: `${serverScheme}://output/${result.image.subfolder}/${result.image.filename}`,
      filename: result.image.filename,
      sourceName: result.image.filename,

      videoUrl: "",
      videoServerPath: "",
      videoFilename: "",
      videoSourceName: "",

      generatedDescription: "",
      generatedPrompt: workflow["474"].inputs.prompt,
      workflow: "qwen21_asset_card.api.json",
    });
  } catch (error) {
    console.error("[qwen21-asset-card]", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Qwen Image Edit 2.1 Asset Card failed.",
      },
      { status: 500 },
    );
  }
}
