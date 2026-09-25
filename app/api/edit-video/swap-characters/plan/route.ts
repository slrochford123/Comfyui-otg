import { NextRequest, NextResponse } from "next/server";

type SwapEngine = "scail2" | "minimax-h3";

type SwapMapping = {
  id: number;
  sourceLabel: string;
  sourceSelector: string;
  replacementLabel: string;
  replacementImageName: string;
  notes: string;
};

function cleanText(value: FormDataEntryValue | null, fallback = "") {
  return String(value || fallback)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function cleanEngine(value: FormDataEntryValue | null): SwapEngine {
  return value === "minimax-h3" ? "minimax-h3" : "scail2";
}

function parsePositiveNumber(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function buildScail2Prompt(sourceTitle: string, swaps: SwapMapping[]) {
  const visibleSwaps = swaps
    .map((swap) => {
      const selector = swap.sourceSelector || swap.sourceLabel;
      const replacement = swap.replacementLabel || `replacement character ${swap.id}`;
      return `${selector} is replaced by ${replacement}`;
    })
    .join("; ");

  const detailLines = swaps
    .map((swap) => {
      const character = swap.replacementLabel || `replacement character ${swap.id}`;
      const selector = swap.sourceSelector || swap.sourceLabel;
      const notes = swap.notes ? ` ${swap.notes}` : "";
      return `${character} occupies the same position, body motion, facial performance, and scene interaction as ${selector}.${notes}`;
    })
    .join(" ");

  return [
    `The output is an edited version of ${sourceTitle || "the source video"} with character replacement completed.`,
    visibleSwaps ? `Replacement mapping: ${visibleSwaps}.` : "",
    "The original camera movement, scene lighting, background, timing, props, and original audio are preserved.",
    detailLines,
    "The replacement characters are temporally stable, naturally blended, and matched to the source video perspective.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildMinimaxPrompt(sourceTitle: string, swaps: SwapMapping[]) {
  const subjectDefinitions = swaps
    .map((swap, index) => {
      const subject = `<Subject ${index + 1}>`;
      const picture = `<Picture ${index + 1}>`;
      const source = swap.sourceSelector || swap.sourceLabel;
      const label = swap.replacementLabel || `replacement character ${index + 1}`;
      return `${subject} is ${label} from ${picture}, replacing ${source} in <Video 1>.`;
    })
    .join("\n");

  const retention = [
    "<Video 1>: partially_preserved - preserve source timing, camera movement, framing, background, lighting, body-performance structure, and original scene continuity.",
    ...swaps.map((swap, index) => {
      const subject = `<Subject ${index + 1}>`;
      const source = swap.sourceSelector || swap.sourceLabel;
      return `${subject}: attribute_transfer - transfer identity and visible appearance from <Picture ${index + 1}> onto ${source}.`;
    }),
  ].join("\n");

  const firstShot = swaps
    .map((swap, index) => {
      const subject = `<Subject ${index + 1}>`;
      const source = swap.sourceSelector || swap.sourceLabel;
      const notes = swap.notes ? ` ${swap.notes}` : "";
      return `${subject} replaces ${source} while keeping that person's motion, pose, screen position, and interaction with nearby objects.${notes}`;
    })
    .join(" ");

  return [
    "subject_definitions:",
    "<Video 1> is the source video for the target video edit.",
    subjectDefinitions,
    "",
    "summary:",
    `The target video is an edited version of <Video 1>${sourceTitle ? ` (${sourceTitle})` : ""}. The source video's timing, camera movement, environment, and original performance are retained, while the selected visible people are replaced by the referenced subjects.`,
    "",
    "retention_analysis:",
    retention,
    "",
    "detailed_description:",
    `[Shot 1] The target video keeps the original shot structure from <Video 1>. ${firstShot} The final video remains photorealistic and integrated with the source plate, matching grain, black level, color grade, depth of field, focus falloff, motion blur, and overall photographic character.`,
  ].join("\n");
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const engine = cleanEngine(form.get("engine"));
  const sourceTitle = cleanText(form.get("video_title"), "source video");
  const sourceName = cleanText(form.get("video_name"), sourceTitle);
  const preserveAudio = form.get("preserve_audio") !== "false";
  const previewSeconds = parsePositiveNumber(form.get("preview_seconds"), 5, 1, 15);
  const maxPeople = Math.round(parsePositiveNumber(form.get("swap_count"), 1, 1, 3));

  const swaps: SwapMapping[] = [];
  for (let index = 0; index < maxPeople; index += 1) {
    const id = index + 1;
    const replacement = form.get(`replacement_${index}_file`);
    const replacementFile = replacement instanceof File ? replacement : null;
    const sourceLabel = cleanText(form.get(`swap_${index}_source_label`), `Character ${String.fromCharCode(65 + index * 2)}`);
    const sourceSelector = cleanText(form.get(`swap_${index}_source_selector`), sourceLabel);
    const replacementLabel = cleanText(form.get(`swap_${index}_replacement_label`), `Character ${String.fromCharCode(66 + index * 2)}`);
    const notes = cleanText(form.get(`swap_${index}_notes`));
    const replacementImageName = cleanText(form.get(`swap_${index}_replacement_name`), replacementFile?.name || "");

    if (!sourceSelector && !replacementImageName && !replacementLabel) continue;
    swaps.push({
      id,
      sourceLabel,
      sourceSelector,
      replacementLabel,
      replacementImageName: replacementImageName || replacementFile?.name || `replacement_${id}.png`,
      notes,
    });
  }

  if (!sourceName) {
    return NextResponse.json({ ok: false, error: "Choose or upload a source video first." }, { status: 400 });
  }
  if (swaps.length === 0) {
    return NextResponse.json({ ok: false, error: "Add at least one character swap mapping." }, { status: 400 });
  }

  const prompt = engine === "minimax-h3" ? buildMinimaxPrompt(sourceTitle, swaps) : buildScail2Prompt(sourceTitle, swaps);
  const recipe =
    engine === "minimax-h3"
      ? {
          workflowTemplate: "video_minimax_h3_r2v.json",
          primaryNode: "MiniMaxH3ReferenceToVideo",
          references: {
            ref_video_1: sourceName,
            ref_images: swaps.map((swap, index) => ({
              slot: `ref_image_${index + 1}`,
              tag: `<Picture ${index + 1}>`,
              fileName: swap.replacementImageName,
              subjectTag: `<Subject ${index + 1}>`,
            })),
          },
          recommendedSettings: {
            ref_image_size: "max",
            fps: 24,
            length: "preview first; model-trained range is about 5 to 15 seconds",
            preserveAudio,
          },
          nextBackendStep: "Submit preview segment to MiniMax H3 Ref2VA, then restore original audio after approval.",
        }
      : {
          workflowTemplate: "video_wan21_scail2_character_replacement.json",
          primaryNode: "WanSCAILToVideo",
          tracking: swaps.map((swap, index) => ({
            segment: index + 1,
            sam3_video_object: swap.sourceSelector || swap.sourceLabel,
            sam3_image_object: "human",
            reference_image: swap.replacementImageName,
          })),
          recommendedSettings: {
            replace_mode: true,
            frame_count: 81,
            segmentStrideFrames: 76,
            previous_frame_count: 5,
            width: 896,
            height: 512,
            preserveAudio,
          },
          nextBackendStep: "Generate a SCAIL-2 preview segment with colored masks, then stitch approved segments and restore original audio.",
        };

  return NextResponse.json({
    ok: true,
    mode: "planning",
    engine,
    source: {
      title: sourceTitle,
      fileName: sourceName,
    },
    preserveAudio,
    previewSeconds,
    swaps,
    prompt,
    recipe,
    safety: {
      inferenceSubmitted: false,
      note: "This endpoint builds the test recipe only. It does not submit a ComfyUI job.",
    },
  });
}
