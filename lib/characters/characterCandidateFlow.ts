export const CHARACTER_CANDIDATE_EDIT_CONTRACT = {
  workflowId: "presets/Edit Image",
  verifiedTemplateName: "image_qwen_image_edit_2509.json",
  inputNodeId: "78",
  positiveNodeId: "433:111",
  negativeNodeId: "433:110",
  seedNodeId: "433:3",
  lightningNodeId: "433:443",
  stepsNodeId: "433:436",
  cfgNodeId: "433:437",
  decodedImageNodeId: "433:8",
  verifiedTemplateOutputNodeId: "469",
  runtimeOutputNodeId: "60",
  model: "qwen_image_edit_2509_fp8_e4m3fn.safetensors",
  clip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
  vae: "qwen_image_vae.safetensors",
  lora: "Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors",
} as const;

export const CHARACTER_EDIT_PRESERVATION_TEXT =
  "Preserve the character's identity, face, hairstyle, body proportions, pose, composition, clothing, accessories, and every unspecified detail exactly as shown.";

export function composeCharacterEditInstruction(requestedChange: string) {
  const requested = String(requestedChange || "").replace(/\s+/g, " ").trim();
  if (!requested) throw new Error("Describe the requested change before applying the edit.");
  return `${requested} ${CHARACTER_EDIT_PRESERVATION_TEXT}`;
}

export type CharacterCandidateLineage = {
  sourceCandidateId?: string;
  rootCandidateId?: string;
  editDepth?: number;
  editInstruction?: string;
};

export function nextCharacterEditLineage<T extends { id: string } & CharacterCandidateLineage>(
  source: T,
  editInstruction: string,
): Required<CharacterCandidateLineage> {
  return {
    sourceCandidateId: source.id,
    rootCandidateId: source.rootCandidateId || source.id,
    editDepth: Math.max(0, Number(source.editDepth) || 0) + 1,
    editInstruction,
  };
}

export function appendCharacterEditCandidate<T extends { id: string }>(candidates: readonly T[], edited: T) {
  if (candidates.some((candidate) => candidate.id === edited.id)) return [...candidates];
  return [...candidates, edited];
}

export function characterEditSubmissionFields(args: {
  sourceServerPath: string;
  requestedChange: string;
  negativePrompt?: string;
  seed: string;
}) {
  const sourceServerPath = String(args.sourceServerPath || "").trim();
  if (!sourceServerPath) throw new Error("The candidate does not have a stable source image for editing.");
  const instruction = composeCharacterEditInstruction(args.requestedChange);

  return {
    instruction,
    fields: {
      workflowId: CHARACTER_CANDIDATE_EDIT_CONTRACT.workflowId,
      workflowLabel: "Characters Candidate Modify",
      requestKind: "character-candidate-edit",
      sourceType: "characters-tab-candidate-edit",
      imageAPath: sourceServerPath,
      loadImageNodeId: CHARACTER_CANDIDATE_EDIT_CONTRACT.inputNodeId,
      positivePrompt: instruction,
      prompt: instruction,
      negativePrompt: String(args.negativePrompt || "").trim(),
      seed: args.seed,
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
      galleryExclusionPolicy: "character-candidate-edit-only",
    },
  };
}

export function characterCardPersistenceFields(processedSourcePath: string, characterCardPath: string) {
  const defaultImagePath = String(processedSourcePath || "").trim();
  const cardPath = String(characterCardPath || "").trim();
  if (!defaultImagePath) throw new Error("A processed background-free character source is required.");
  if (!cardPath) throw new Error("An accepted character-card sheet is required.");
  return {
    imagePath: defaultImagePath,
    previewImagePath: defaultImagePath,
    defaultCharacterImagePath: defaultImagePath,
    defaultCharacterPreviewImagePath: defaultImagePath,
    backgroundRemovedDefaultImagePath: defaultImagePath,
    defaultCharacterSourceImagePath: defaultImagePath,
    defaultCharacterImageStatus: "background_removed" as const,
    characterCardPath: cardPath,
    characterCardWorkflowImagePath: cardPath,
    characterCardPreviewImagePath: cardPath,
  };
}
