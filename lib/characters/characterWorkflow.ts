import { CHARACTER_CANDIDATE_EDIT_CONTRACT } from "@/lib/characters/characterCandidateFlow";

export type CharacterKind = "standard" | "freeform";
export type CharacterSourceMode = "generated" | "uploaded";
export type CharacterUploadFraming = "head" | "half-body" | "full-body";

export const CHARACTER_UPLOAD_COMPLETION_CONTRACT = {
  workflowId: CHARACTER_CANDIDATE_EDIT_CONTRACT.workflowId,
  inputNodeId: CHARACTER_CANDIDATE_EDIT_CONTRACT.inputNodeId,
  outputNodeId: CHARACTER_CANDIDATE_EDIT_CONTRACT.runtimeOutputNodeId,
  outputFilenamePrefix: "Edit_Image",
  requestKind: "characters-upload-fullbody-completion",
  sourceType: "characters-tab-builder-upload-fullbody",
} as const;

export function normalizeCharacterKind(value: unknown): CharacterKind {
  return value === "freeform" ? "freeform" : "standard";
}

export function normalizeCharacterSourceMode(value: unknown): CharacterSourceMode {
  return value === "uploaded" ? "uploaded" : "generated";
}

export function normalizeCharacterUploadFraming(value: unknown): CharacterUploadFraming {
  if (value === "head" || value === "half-body" || value === "full-body") return value;
  return "full-body";
}

function compact(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function characterUploadCompletionPlan(args: {
  kind: CharacterKind;
  framing: CharacterUploadFraming;
  completionPrompt?: string;
}) {
  if (args.framing === "full-body") {
    return {
      requiresCompletion: false as const,
      instruction: "",
      negativePrompt: "",
      orientation: "portrait" as const,
    };
  }

  const requestedBody = compact(args.completionPrompt);
  if (!requestedBody) {
    throw new Error(
      args.kind === "freeform"
        ? "Describe the complete intended Character or full form before completion."
        : "Describe the intended full body and clothing before completion.",
    );
  }

  const sourceScope = args.framing === "head"
    ? "The source shows the Character's head or face."
    : "The source shows the Character's upper or partial body.";

  if (args.kind === "freeform") {
    const instruction = [
      "Complete the entire intended Character from the uploaded reference.",
      sourceScope,
      "Preserve the exact visible identity, face or defining front features, colors, materials, style, and every already-visible anatomical feature.",
      "The user's anatomy description is authoritative.",
      "Extend only what is missing according to that description.",
      "Preserve unusual anatomy, body proportions, limb counts, head counts, tails, wings, appendages, mechanical construction, or amorphous form when specified or visible.",
      "Do not force humanoid anatomy, ordinary human proportions, two arms, two legs, human hands, human feet, or an ordinary human torso or head-body relationship unless the user explicitly requests them.",
      "Show the entire intended Character or full form, centered and uncropped, with enough empty space around every visible extremity or boundary.",
      `User anatomy and completion description: ${requestedBody}`,
    ].join(" ");

    return {
      requiresCompletion: true as const,
      instruction,
      negativePrompt: [
        "cropped character",
        "cropped form",
        "changed identity",
        "changed face",
        "changed visible anatomy",
        "forced humanoid anatomy",
        "human proportions unless requested",
        "two arms unless requested",
        "two legs unless requested",
        "removed appendage",
        "added human limbs",
        "different character",
        "blurry",
        "low quality",
        "watermark",
        "text",
      ].join(", "),
      orientation: /\blandscape\b|\bwide\b|\bhorizontal\b/i.test(requestedBody)
        ? "landscape" as const
        : "portrait" as const,
    };
  }

  return {
    requiresCompletion: true as const,
    instruction: [
      "Create a complete full-body standard Character from the uploaded reference.",
      sourceScope,
      "Preserve the exact face, identity, hairstyle, skin tone, visible upper-body proportions, visible clothing, colors, materials, and style.",
      "Do not redesign or replace the face or identity.",
      "Extend only the missing body and clothing according to the user's description.",
      "Show one ordinary complete Character standing in a neutral front-facing pose, fully visible and uncropped from the top of the head through both feet.",
      "Keep both arms, both hands, both legs, clothing, footwear, and feet completely visible where ordinary human anatomy applies.",
      `User full-body and clothing description: ${requestedBody}`,
    ].join(" "),
    negativePrompt: [
      "cropped body",
      "cropped feet",
      "cropped head",
      "changed face",
      "changed identity",
      "changed visible clothing",
      "different character",
      "extra limbs",
      "missing limbs",
      "bad anatomy",
      "blurry",
      "low quality",
      "watermark",
      "text",
    ].join(", "),
    orientation: "portrait" as const,
  };
}

export function characterUploadCompletionSubmissionFields(args: {
  sourceServerPath: string;
  kind: CharacterKind;
  framing: CharacterUploadFraming;
  completionPrompt: string;
  seed: string;
}) {
  const sourceServerPath = compact(args.sourceServerPath);
  if (!sourceServerPath) {
    throw new Error("The uploaded Character source does not have a stable owner-scoped path.");
  }

  const plan = characterUploadCompletionPlan(args);
  if (!plan.requiresCompletion) {
    throw new Error("A Full Body upload must skip Qwen completion and continue directly to processing.");
  }

  const landscape = plan.orientation === "landscape";
  return {
    plan,
    fields: {
      workflowId: CHARACTER_UPLOAD_COMPLETION_CONTRACT.workflowId,
      workflowLabel: "Characters Full Body Completion",
      requestKind: CHARACTER_UPLOAD_COMPLETION_CONTRACT.requestKind,
      sourceType: CHARACTER_UPLOAD_COMPLETION_CONTRACT.sourceType,
      imageAPath: sourceServerPath,
      loadImageNodeId: CHARACTER_UPLOAD_COMPLETION_CONTRACT.inputNodeId,
      prompt: plan.instruction,
      positivePrompt: plan.instruction,
      negativePrompt: plan.negativePrompt,
      orientation: plan.orientation,
      aspectRatio: landscape ? "16:9" : "9:16",
      width: landscape ? "1280" : "832",
      height: landscape ? "720" : "1216",
      seed: compact(args.seed),
      saveToGallery: "false",
      save_to_gallery: "false",
      persistToGallery: "false",
      addToGallery: "false",
      copyToGallery: "false",
      gallery: "false",
      skipGallery: "true",
      skipGeneralGallery: "true",
      assetLibraryOnly: "true",
      outputLibrary: "characters",
      galleryExclusionPolicy: "character-builder-fullbody-completion-only",
      characterAnatomyMode: args.kind,
      characterSourceFraming: args.framing,
    },
  };
}

export function characterCreationMetadata(args: {
  kind?: unknown;
  sourceMode?: unknown;
  uploadFraming?: unknown;
}) {
  const kind = normalizeCharacterKind(args.kind);
  const sourceMode = normalizeCharacterSourceMode(args.sourceMode);
  return {
    characterKind: kind,
    sourceMode,
    ...(sourceMode === "uploaded"
      ? { uploadFraming: normalizeCharacterUploadFraming(args.uploadFraming) }
      : {}),
  };
}
