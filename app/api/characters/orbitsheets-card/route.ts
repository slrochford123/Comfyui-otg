import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  ORBITSHEETS_ANCHOR_HEIGHT,
  ORBITSHEETS_ANCHOR_WIDTH,
  prepareOrbitSheetsAnchor,
} from "@/lib/characters/orbitSheetsAnchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMFY_BASE =
  process.env.OTG_H3_COMFY_BASE_URL ||
  process.env.H3_COMFY_BASE_URL ||
  "http://100.75.162.64:8189";

const COMFY_ROOT =
  process.env.OTG_COMFYUI_ROOT ||
  "/home/shawn-rochford/AI/ComfyUI/ComfyUI";

const ORBIT_WORKFLOW =
  process.env.OTG_ORBITSHEETS_CHARACTER_WORKFLOW ||
  "/home/shawn-rochford/AI/ComfyUI/ComfyUI/custom_nodes/ComfyUI-OrbitSheets/api_workflows/CharacterTurnaroundSheetH3.json";

function asString(value: unknown) {
  return String(value || "").trim();
}

function basenameSafe(value: string) {
  return path.basename(value).replace(/[^a-zA-Z0-9._-]/g, "_");
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

async function objectInfo() {
  return comfyJson(`${COMFY_BASE}/object_info`);
}

function choices(
  info: any,
  nodeType: string,
  inputName: string,
): string[] {
  const value =
    info?.[nodeType]?.input?.required?.[inputName]?.[0];

  return Array.isArray(value) ? value.map(String) : [];
}

function resolveChoice(
  info: any,
  nodeType: string,
  inputName: string,
  wantedBasename: string,
) {
  const values = choices(info, nodeType, inputName);

  const exact = values.find((value) => value === wantedBasename);
  if (exact) return exact;

  const suffix = values.find((value) =>
    value.endsWith(wantedBasename),
  );
  if (suffix) return suffix;

  throw new Error(
    `${nodeType}.${inputName} does not expose ${wantedBasename}`,
  );
}

async function waitForOutput(promptId: string) {
  const deadline = Date.now() + 8 * 60 * 1000;

  while (Date.now() < deadline) {
    const history = await comfyJson(
      `${COMFY_BASE}/history/${encodeURIComponent(promptId)}`,
    );

    const result = history?.[promptId];

    if (result) {
      const status = result?.status;

      if (
        status?.status_str === "error" ||
        status?.completed === false
      ) {
        throw new Error(
          `OrbitSheets ComfyUI prompt failed: ${JSON.stringify(status)}`,
        );
      }

      const finalOutput = result?.outputs?.["70"];
      const finalImages = Array.isArray(finalOutput?.images)
        ? finalOutput.images
        : [];

      for (const image of finalImages) {
        if (
          String(image?.type || "") === "output" &&
          String(image?.filename || "").trim()
        ) {
          return {
            filename: String(image.filename),
            subfolder: String(image.subfolder || ""),
            type: "output",
          };
        }
      }

      if (status?.completed === true) {
        throw new Error(
          "OrbitSheets completed without a final Character Card image from output node 70.",
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error(
    `OrbitSheets timed out waiting for prompt ${promptId}`,
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.formData();

    const sourceServerPath = asString(
      body.get("sourceServerPath"),
    );
    const characterDescription = asString(
      body.get("characterDescription"),
    );
    const anatomyMode = asString(body.get("anatomyMode"));

    if (!sourceServerPath) {
      return NextResponse.json(
        { error: "sourceServerPath is required." },
        { status: 400 },
      );
    }

    const source = path.resolve(sourceServerPath);

    await fs.access(source);

    const inputDir = path.join(
      COMFY_ROOT,
      "input",
      "otg_orbitsheets_character",
    );

    await fs.mkdir(inputDir, { recursive: true });

    const sourceStem = path.parse(basenameSafe(source)).name;
    const sourceName = `${Date.now()}-${sourceStem}-proportional-anchor.png`;
    const target = path.join(inputDir, sourceName);

    await prepareOrbitSheetsAnchor(source, target);

    const rawWorkflow = await fs.readFile(
      ORBIT_WORKFLOW,
      "utf8",
    );

    const workflow = JSON.parse(rawWorkflow);
    const info = await objectInfo();

    const h3Model = resolveChoice(
      info,
      "UNETLoader",
      "unet_name",
      "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    );

    const turboLora = resolveChoice(
      info,
      "LoraLoaderModelOnly",
      "lora_name",
      "minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors",
    );

    const description =
      characterDescription ||
      "the exact same character from Picture 1";

    const freeform =
      anatomyMode === "freeform"
        ? [
            "Preserve the subject's natural anatomy exactly.",
            "Do not force humanoid anatomy.",
            "If animal or quadruped, keep it naturally on all fours.",
            "If creature, object, spirit, plant, aquatic, robotic, floating, or amorphous, preserve its natural full form.",
          ].join(" ")
        : [
            "Preserve the exact same human identity, face, hairstyle, body proportions, outfit, colors, materials, and accessories.",
          ].join(" ");

    const prompt = `
Create a six-view character reference turnaround of the exact same character from Picture 1.

Identity lock:
${description}
${freeform}
Preserve the exact same identity, colors, proportions, materials, markings, clothing, accessories, silhouette, and anatomy in every shot.
Do not redesign the subject.

Background:
Plain seamless neutral grey studio backdrop with soft even reference lighting.

Shot plan:
[Shot 1] Full-body front view, entire character visible with generous margin.
[Shot 2] Full-body left profile, exact 90-degree side view.
[Shot 3] Full-body right profile, exact 90-degree side view.
[Shot 4] Full-body rear view, directly from behind.
[Shot 5] Full-body three-quarter front view, approximately 45 degrees.
[Shot 6] Face or identity close-up, neutral expression where applicable.

Each shot is static and locked-off.
Use hard cuts between shots.
No walking.
No continuous orbit.
No duplicate close-ups.
No cropping.
No extra characters.
`.trim();

    workflow["10"].inputs.value = description;

    workflow["30"].inputs.visual_style =
      "Cinematic, live-action, realistic studio character reference photography";
    workflow["30"].inputs.backdrop =
      "plain seamless neutral grey studio backdrop";
    workflow["30"].inputs.framing =
      "full body, generous margin";
    workflow["30"].inputs.spoken_line = "";
    workflow["30"].inputs.voice_description = "";
    workflow["30"].inputs.ambient_sound = "";
    workflow["30"].inputs.scared_shot = false;
    workflow["30"].inputs.shot_seconds = 0.75;

    workflow["90"] = {
      class_type: "LoadImage",
      inputs: {
        image: `otg_orbitsheets_character/${sourceName}`,
      },
      _meta: {
        title: "OTG Existing Character Source",
      },
    };

    workflow["44"].inputs.first_frame = ["90", 0];
    workflow["44"].inputs.prompt = prompt;
    workflow["44"].inputs.width = ORBITSHEETS_ANCHOR_WIDTH;
    workflow["44"].inputs.height = ORBITSHEETS_ANCHOR_HEIGHT;
    workflow["44"].inputs.length = 124;

    workflow["40"].inputs.unet_name = h3Model;

    workflow["39"].inputs.lora_name = turboLora;
    workflow["39"].inputs.strength_model = 1.0;

    workflow["74"].inputs.model = ["39", 0];

    delete workflow["73"];

    workflow["47"].inputs.steps = 4;

    workflow["60"].inputs.count = 6;
    workflow["60"].inputs.mode = "sharpness_diversity";
    workflow["60"].inputs.keep_first_frame = false;
    workflow["60"].inputs.shots = 6;
    workflow["60"].inputs.boards = 1;
    workflow["60"].inputs.shot_split = "views (by content)";
    workflow["60"].inputs.subject_hint = description;
    workflow["60"].inputs.selection_brief =
      "Select exactly one sharp representative frame from each distinct shot. Priority: full-body front, left profile, right profile, rear, three-quarter front, identity close-up. Reject the original anchor frame, duplicates, transition frames, cropped bodies, motion blur, anatomy errors, changed markings, changed clothing, and changed identity.";

    delete workflow["60"].inputs.clip;

    workflow["61"].inputs.columns = 2;
    workflow["61"].inputs.cell_width = 512;
    workflow["61"].inputs.padding = 8;
    workflow["61"].inputs.label_frames = false;

    workflow["70"].inputs.filename_prefix =
      "otg-character-card-orbitsheets/Character Card OrbitSheets";

    for (const nodeId of [
      "20",
      "21",
      "22",
      "25",
      "26",
      "27",
      "28",
      "29",
      "80",
      "51",
      "52",
      "71",
      "72",
      "75",
      "76",
      "77",
    ]) {
      delete workflow[nodeId];
    }

    const submission = await comfyJson(
      `${COMFY_BASE}/prompt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: workflow,
          client_id: `otg-orbitsheets-${Date.now()}`,
        }),
      },
    );

    const promptId = asString(
      submission?.prompt_id || submission?.promptId,
    );

    if (!promptId) {
      throw new Error(
        "OrbitSheets did not return a ComfyUI prompt id.",
      );
    }

    const image = await waitForOutput(promptId);

    const url =
      `/api/comfy-image?filename=${encodeURIComponent(image.filename)}` +
      `&subfolder=${encodeURIComponent(image.subfolder)}` +
      `&type=${encodeURIComponent(image.type)}`;

    const serverPath = path.join(
      COMFY_ROOT,
      "output",
      image.subfolder,
      image.filename,
    );

    return NextResponse.json({
      ok: true,
      engine: "orbitsheets-h3",
      promptId,
      url,
      serverPath,
      filename: image.filename,
      sourceName: image.filename,
    });
  } catch (error) {
    console.error("[orbitsheets-character-card]", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "OrbitSheets Character Card failed.",
      },
      { status: 500 },
    );
  }
}
