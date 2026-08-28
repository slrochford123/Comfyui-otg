export const CHARACTER_CARD_WORKFLOW_ID = "presets/character_card_8_angles_low_angle";

export async function submitCharacterCardJob(args: {
  sourceServerPath: string;
  fetchImpl?: typeof fetch;
  requestInit?: Pick<RequestInit, "credentials" | "headers">;
}) {
  const sourceServerPath = String(args.sourceServerPath || "").trim();
  if (!sourceServerPath) throw new Error("Character Card requires a processed background-free source image.");

  const body = new FormData();
  body.set("workflowId", CHARACTER_CARD_WORKFLOW_ID);
  body.set("workflowLabel", "Characters 8-Angle Character Card");
  body.set("requestKind", "characters-8-angle-card");
  body.set("sourceType", "characters-8-angle-card");
  body.set("imageAPath", sourceServerPath);
  body.set("loadImageNodeId", "25");
  body.set("saveImageNodeId", "439");
  body.set("characterCardOutputNodeId", "439");
  body.set("saveToGallery", "false");
  body.set("save_to_gallery", "false");
  body.set("persistToGallery", "false");
  body.set("addToGallery", "false");
  body.set("copyToGallery", "false");
  body.set("gallery", "false");
  body.set("skipGallery", "true");
  body.set("skipGeneralGallery", "true");
  body.set("assetLibraryOnly", "true");
  body.set("outputLibrary", "characters");
  body.set("galleryExclusionPolicy", "character-card-only");

  const response = await (args.fetchImpl || fetch)("/api/comfy", {
    method: "POST",
    body,
    ...args.requestInit,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) throw new Error(json?.error || `Character card submit failed (${response.status}).`);

  const promptId = String(json.prompt_id || json.promptId || "").trim();
  if (!promptId) throw new Error("Character card workflow did not return a ComfyUI prompt id.");
  return { promptId };
}
