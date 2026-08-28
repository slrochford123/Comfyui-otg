export const CREATE_VIDEO_FROM_IMAGES_WORKFLOW_ID =
  "presets/Create a Video from Images";

function normalizeWorkflowIdentity(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\.json$/i, "")
    .toLowerCase();
}

/**
 * Ensures the explicit Generate-page preset owns graph selection.
 *
 * Legacy clients may submit workflowFile/workflowPath values for the old
 * production image-to-video graph together with the explicit
 * "Create a Video from Images" preset. Those legacy path fields must not
 * override the explicit preset.
 */
export function normalizeExplicitCreateVideoFromImagesRequest(
  body: Record<string, any> | null | undefined
): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;

  const explicitWorkflowId = normalizeWorkflowIdentity(
    body.workflowId || body.preset || body.id
  );

  if (
    explicitWorkflowId !==
    normalizeWorkflowIdentity(CREATE_VIDEO_FROM_IMAGES_WORKFLOW_ID)
  ) {
    return false;
  }

  body.workflowId = CREATE_VIDEO_FROM_IMAGES_WORKFLOW_ID;
  body.preset = CREATE_VIDEO_FROM_IMAGES_WORKFLOW_ID;

  body.workflowFile = "";
  body.workflowPath = "";
  body.workflowJsonPath = "";
  body.workflowPresetPath = "";

  return true;
}
