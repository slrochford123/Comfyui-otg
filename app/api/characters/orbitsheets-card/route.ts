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

const CARD_EXPRESSIONS = [
  "neutral",
  "happy",
  "smiling",
  "sad",
  "angry",
  "surprised",
  "scared",
  "disgusted",
  "shy/embarrassed",
  "confident",
  "serious",
  "laughing",
  "crying",
  "smirking",
  "confused",
] as const;

type CardExpression = (typeof CARD_EXPRESSIONS)[number];

type ShotConfig = {
  angle: string;
  framing: string;
  expression: CardExpression;
};

function normalizeExpression(value: string): CardExpression {
  const normalized = value.trim().toLowerCase();
  return (CARD_EXPRESSIONS as readonly string[]).includes(normalized)
    ? (normalized as CardExpression)
    : "neutral";
}

function standardCharacterShots(expression: CardExpression): ShotConfig[] {
  return [
    { angle: "front", framing: "wide shot (full body)", expression },
    { angle: "back", framing: "wide shot (full body)", expression },
    { angle: "left profile", framing: "wide shot (full body)", expression },
    { angle: "right profile", framing: "wide shot (full body)", expression },
    { angle: "front", framing: "medium shot (waist-up)", expression },
    { angle: "front", framing: "close-up (shoulders/face)", expression },
  ];
}

function freeformCharacterShots(expression: CardExpression): ShotConfig[] {
  return [
    { angle: "left profile", framing: "wide shot (full body)", expression },
    { angle: "right profile", framing: "wide shot (full body)", expression },
    { angle: "front", framing: "wide shot (full body)", expression },
    { angle: "back", framing: "wide shot (full body)", expression },
    { angle: "front", framing: "close-up (shoulders/face)", expression },
    { angle: "back", framing: "close-up (upper back/head)", expression },
  ];
}

function applyShotPreset(
  workflow: any,
  anatomyMode: string,
  expression: CardExpression,
) {
  const shots =
    anatomyMode === "freeform"
      ? freeformCharacterShots(expression)
      : standardCharacterShots(expression);

  shots.forEach((shot, index) => {
    const nodeId = String(190 + index);
    const node = workflow?.[nodeId];

    if (!node || node.class_type !== "H3LookSheetsShotConfig") {
      throw new Error(
        `H3 look-sheet workflow is missing expected shot node ${nodeId}.`,
      );
    }

    node.inputs.angle = shot.angle;
    node.inputs.framing = shot.framing;
    node.inputs.expression = shot.expression;
  });
}

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

function workflowPath(anatomyMode: string) {
  const filename =
    anatomyMode === "freeform"
      ? "freeform_card.api.json"
      : "character_card.api.json";

  return path.join(
    process.cwd(),
    "comfy_workflows",
    "card_builder",
    filename,
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
  const bytes = await fs.readFile(sourcePath);
  const originalName = path.basename(sourcePath);
  const extension = path.extname(originalName) || ".png";
  const stem =
    path
      .basename(originalName, path.extname(originalName))
      .replace(/[^a-zA-Z0-9._-]/g, "_") || "character";

  const uploadName = `otg-card-${Date.now()}-${stem}${extension}`;

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
          `H3 Character Card failed: ${JSON.stringify(status)}`,
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
          "H3 Character Card completed without both node 70 PNG and node 79 MP4 outputs.",
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error(
    `H3 Character Card timed out waiting for prompt ${promptId}`,
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

  return `/api/characters/orbitsheets-card?${params.toString()}`;
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
    console.error("[h3-character-card-view]", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "H3 Character Card output fetch failed.",
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
    const anatomyMode = asString(body.get("anatomyMode"));
    const expression = normalizeExpression(
      asString(body.get("expression")),
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
      workflowPath(anatomyMode),
      "utf8",
    );

    const workflow = JSON.parse(rawWorkflow);

    if (
      !workflow?.["81"] ||
      workflow["81"].class_type !== "LoadImage"
    ) {
      throw new Error(
        "H3 card workflow is missing expected LoadImage node 81.",
      );
    }

    applyShotPreset(workflow, anatomyMode, expression);

    async function submitOnBackend(backend: H3CardBackend) {
      const baseUrl = comfyBaseUrl(backend);
      const backendWorkflow = JSON.parse(JSON.stringify(workflow));
      const uploadedName =
        await uploadSourceToBackend(source, baseUrl);

      backendWorkflow["81"].inputs.image = uploadedName;

      const submissionResponse =
        await submitComfyPromptWith5060Lease({
          baseUrl,
          workerId: `api-character-h3-card-${backend}`,
          init: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              prompt: backendWorkflow,
              client_id: `otg-h3-card-${backend}-${Date.now()}`,
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
          "H3 Character Card did not return a ComfyUI prompt id.",
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
        "[h3-character-card] RTX 5060 Ti primary submission failed; trying RTX 3090 backup.",
        primaryError,
      );
      submission = await submitOnBackend("rtx3090");
    }

    const { backend, baseUrl, promptId } = submission;
    const result = await waitForOutputs(promptId, baseUrl);

    const url = proxyUrl(result.image, "image", backend);
    const videoUrl = proxyUrl(result.video, "video", backend);
    const serverScheme =
      backend === "rtx5060ti" ? "comfy5060" : "comfy3090";

    return NextResponse.json({
      ok: true,

      // Preserve current Character Builder recovery contract.
      engine: "orbitsheets-h3",
      promptId,
      backend,

      url,
      serverPath: `${serverScheme}://output/${result.image.subfolder}/${result.image.filename}`,
      filename: result.image.filename,
      sourceName: result.image.filename,

      videoUrl,
      videoServerPath: `${serverScheme}://output/${result.video.subfolder}/${result.video.filename}`,
      videoFilename: result.video.filename,
      videoSourceName: result.video.filename,

      generatedDescription: result.description,
      generatedPrompt: result.prompt,

      workflow:
        anatomyMode === "freeform"
          ? "freeform_card.api.json"
          : "character_card.api.json",
    });
  } catch (error) {
    console.error("[h3-character-card]", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "H3 Character Card failed.",
      },
      { status: 500 },
    );
  }
}
