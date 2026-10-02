import type {
  H3Orientation,
  H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import type { ProductionV2H3Mode } from "@/lib/production/h3Workflows";

export type H3StudioReferenceKind = "image" | "video" | "audio";

export type H3StudioReferenceDescriptor = {
  id: string;
  kind: H3StudioReferenceKind;
  name: string;
  description: string;
  includeAudio?: boolean;
  clipStartSeconds?: number;
  clipDurationSeconds?: number;
};

export type H3StudioLoraSelection = {
  id: string;
  strength: number;
};

export type H3StudioPromptContext = {
  mode: ProductionV2H3Mode;
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: 5 | 10;
  originalPrompt: string;
  scenePrompt: string;
  visualStyle: string;
  cameraFeel: string;
  shotFlow: string;
  soundDirection?: string;
  thingsToAvoid?: string;
  structured?: Record<string, string>;
  firstImageName?: string;
  lastImageName?: string;
  references: H3StudioReferenceDescriptor[];
  loras: H3StudioLoraSelection[];
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

type H3QuotedDialogue = {
  text: string;
  quoted: string;
};

export function extractH3QuotedDialogue(value: unknown): H3QuotedDialogue[] {
  const prompt = String(value ?? "");
  const matches: H3QuotedDialogue[] = [];
  const pattern = /"([^"\r\n]+)"|“([^”\r\n]+)”|‘([^’\r\n]+)’/gu;
  for (const match of prompt.matchAll(pattern)) {
    const text = String(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!text) continue;
    matches.push({ text, quoted: String(match[0]) });
  }
  return matches;
}

export function buildH3QuotedDialogueContract(value: unknown) {
  const dialogue = extractH3QuotedDialogue(value);
  if (!dialogue.length) return "";
  return [
    "IMMUTABLE QUOTED DIALOGUE CONTRACT:",
    "Every quoted line below must appear in the finished Scene Prompt word-for-word, in quotation marks, and in this exact order.",
    "Do not omit, summarize, paraphrase, translate, merge, or add words to these spoken lines.",
    ...dialogue.map((item, index) => `${index + 1}. ${item.quoted}`),
  ].join("\n");
}

export function preserveH3QuotedDialogue(
  originalPrompt: unknown,
  generatedPrompt: unknown,
) {
  const original = extractH3QuotedDialogue(originalPrompt);
  const generated = clean(generatedPrompt);
  if (!original.length) return generated;

  const available = new Map<string, number>();
  for (const item of extractH3QuotedDialogue(generated)) {
    available.set(item.text, (available.get(item.text) || 0) + 1);
  }

  const missing = original.filter((item) => {
    const count = available.get(item.text) || 0;
    if (count <= 0) return true;
    available.set(item.text, count - 1);
    return false;
  });
  if (!missing.length) return generated;

  const dialogueBlock = [
    "Spoken dialogue — preserve verbatim:",
    ...missing.map((item) => item.quoted),
  ].join("\n");
  return [generated, dialogueBlock]
    .filter(Boolean)
    .join("\n\n");
}

export function buildH3StudioLockedReferences(
  context: Pick<
    H3StudioPromptContext,
    "mode" | "firstImageName" | "lastImageName" | "references"
  >,
) {
  if (context.mode === "h3-text-to-video") return "";
  if (context.mode === "h3-image-to-video") {
    const lines = context.firstImageName
      ? [`<Picture 1> = First Image: ${clean(context.firstImageName)}`]
      : [];
    if (context.lastImageName)
      lines.push(`<Picture 2> = Last Image: ${clean(context.lastImageName)}`);
    return lines.join("\n");
  }

  let picture = 0;
  let video = 0;
  let audio = context.references.filter(
    (reference) => reference.kind === "video" && reference.includeAudio,
  ).length;
  const grouped = [
    ...context.references.filter((reference) => reference.kind === "image"),
    ...context.references.filter((reference) => reference.kind === "video"),
    ...context.references.filter((reference) => reference.kind === "audio"),
  ];
  let videoAudio = 0;
  return grouped
    .map((reference) => {
      const detail = clean(reference.description) || clean(reference.name);
      if (reference.kind === "image") {
        picture += 1;
        return `<Picture ${picture}> / <Subject ${picture}> = ${detail}`;
      }
      if (reference.kind === "video") {
        video += 1;
        if (reference.includeAudio) videoAudio += 1;
        return `<Video ${video}> = ${detail}${reference.includeAudio ? `\n<Audio ${videoAudio}> = audio from <Video ${video}>` : ""}`;
      }
      audio += 1;
      return `<Audio ${audio}> = ${detail}`;
    })
    .join("\n");
}

export function composeH3StudioFinalPrompt(
  lockedReferences: string,
  scenePrompt: string,
) {
  return [clean(lockedReferences), clean(scenePrompt)]
    .filter(Boolean)
    .join("\n\n");
}

export function h3StudioPromptFingerprint(context: H3StudioPromptContext) {
  return JSON.stringify({
    mode: context.mode,
    quality: context.quality,
    orientation: context.orientation,
    durationSeconds: context.durationSeconds,
    originalPrompt: clean(context.originalPrompt),
    scenePrompt: clean(context.scenePrompt),
    visualStyle: context.visualStyle,
    cameraFeel: context.cameraFeel,
    shotFlow: context.shotFlow,
    soundDirection: clean(context.soundDirection),
    thingsToAvoid: clean(context.thingsToAvoid),
    structured: Object.fromEntries(
      Object.entries(context.structured || {}).map(([key, value]) => [
        key,
        clean(value),
      ]),
    ),
    firstImageName: clean(context.firstImageName),
    lastImageName: clean(context.lastImageName),
    references: context.references.map((reference) => ({
      id: reference.id,
      kind: reference.kind,
      name: clean(reference.name),
      description: clean(reference.description),
      includeAudio: reference.includeAudio === true,
      clipStartSeconds: Number(reference.clipStartSeconds || 0),
      clipDurationSeconds: Number(reference.clipDurationSeconds || 0),
    })),
    loras: context.loras.map((lora) => ({
      id: lora.id,
      strength: Number(lora.strength),
    })),
  });
}
