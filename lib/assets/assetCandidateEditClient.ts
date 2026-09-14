import {
  CHARACTER_CANDIDATE_EDIT_CONTRACT,
  nextCharacterEditLineage,
  type CharacterCandidateLineage,
} from "@/lib/characters/characterCandidateFlow";

export type EditableAssetCandidate = CharacterCandidateLineage & {
  id: string;
  label: string;
  url: string;
  serverPath?: string;
  internalPrompt?: string;
  promptId?: string;
  workflowId?: string;
  backgroundFree?: boolean;
};

export const ASSET_CANDIDATE_EDIT_PRESERVATION_TEXT = [
  "Apply only the requested edit to the asset.",
  "Preserve the asset's exact identity, overall shape, proportions, silhouette, construction, materials, colors, textures, surface finish, markings, decorations, components, orientation, perspective, composition, lighting, and all continuity-critical visible details unless the requested edit explicitly requires changing them.",
  "Keep the same single asset as the source image.",
  "Do not redesign, replace, duplicate, add, remove, resize, reshape, rotate, crop, or alter unrelated parts of the asset unless specifically requested.",
  "Preserve the existing background, framing, camera angle, and object placement unless the edit request explicitly changes them.",
].join(" ");

export function composeAssetCandidateEditInstruction(requestedChange: string) {
  const requested = String(requestedChange || "").replace(/\s+/g, " ").trim();
  if (!requested) throw new Error("Describe the requested asset change before applying the edit.");
  return `Requested edit: ${requested} ${ASSET_CANDIDATE_EDIT_PRESERVATION_TEXT}`;
}

export function assetEditSubmissionFields(args: {
  sourceServerPath: string;
  requestedChange: string;
  negativePrompt?: string;
  seed: string;
}) {
  const sourceServerPath = String(args.sourceServerPath || "").trim();
  if (!sourceServerPath) throw new Error("The asset candidate does not have a stable source image for editing.");
  const instruction = composeAssetCandidateEditInstruction(args.requestedChange);

  return {
    instruction,
    fields: {
      workflowId: CHARACTER_CANDIDATE_EDIT_CONTRACT.workflowId,
      workflowLabel: "Asset Candidate Modify",
      requestKind: "character-candidate-edit",
      sourceType: "asset-gallery-candidate-edit",
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
      outputLibrary: "assets",
      galleryExclusionPolicy: "asset-candidate-edit-only",
    },
  };
}

export async function submitAssetCandidateEditJob(args: {
  sourceServerPath: string;
  requestedChange: string;
  negativePrompt: string;
  seed: string;
  fetchImpl?: typeof fetch;
  requestInit?: Pick<RequestInit, "credentials" | "headers">;
}) {
  const submission = assetEditSubmissionFields(args);
  const body = new FormData();
  for (const [key, value] of Object.entries(submission.fields)) body.set(key, value);

  const response = await (args.fetchImpl || fetch)("/api/comfy", {
    method: "POST",
    body,
    ...args.requestInit,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) {
    throw new Error(json?.error || `Asset candidate edit submit failed (${response.status}).`);
  }
  const promptId = String(json.prompt_id || json.promptId || "").trim();
  if (!promptId) throw new Error("Asset candidate edit did not return a ComfyUI prompt id.");
  return { promptId, instruction: submission.instruction };
}

export async function executeAssetCandidateEdit(args: {
  source: EditableAssetCandidate;
  requestedChange: string;
  negativePrompt: string;
  seed: string;
  resolveOutput: (promptId: string, selector: { nodeId: string; filenamePrefix: string }) => Promise<{ url: string }>;
  persistOutput: (outputUrl: string, filename: string) => Promise<{ serverPath: string; fileUrl?: string }>;
  makeCandidateId?: () => string;
  onSubmitted?: (job: { promptId: string; instruction: string }) => void;
  fetchImpl?: typeof fetch;
  requestInit?: Pick<RequestInit, "credentials" | "headers">;
}): Promise<EditableAssetCandidate> {
  if (!args.source.serverPath) throw new Error("This asset candidate does not have a stable source image for editing.");

  const job = await submitAssetCandidateEditJob({
    sourceServerPath: args.source.serverPath,
    requestedChange: args.requestedChange,
    negativePrompt: args.negativePrompt,
    seed: args.seed,
    fetchImpl: args.fetchImpl,
    requestInit: args.requestInit,
  });
  args.onSubmitted?.(job);
  const output = await args.resolveOutput(job.promptId, {
    nodeId: CHARACTER_CANDIDATE_EDIT_CONTRACT.runtimeOutputNodeId,
    filenamePrefix: "Edit_Image",
  });
  if (!output?.url) throw new Error("Asset candidate edit completed without a resolvable image output.");

  const id = args.makeCandidateId?.() || `edited-${Date.now()}`;
  const upload = await args.persistOutput(output.url, `${id}.png`);
  if (!upload.serverPath) throw new Error("Asset candidate edit output did not receive a stable asset path.");

  return {
    id,
    label: `${args.source.label} - edited`,
    url: upload.fileUrl || output.url,
    serverPath: upload.serverPath,
    internalPrompt: job.instruction,
    promptId: job.promptId,
    workflowId: CHARACTER_CANDIDATE_EDIT_CONTRACT.workflowId,
    ...nextCharacterEditLineage(args.source, job.instruction),
    backgroundFree: false,
  };
}
