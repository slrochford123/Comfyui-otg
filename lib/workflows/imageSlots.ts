export type WorkflowPrompt = Record<string, any>;

export type ImageSlot = {
  nodeId: string;
  inputKey: string; // usually "image"
  classType: string;
};

const IMAGE_NODE_TYPES = new Set([
  "LoadImage",
  "LoadImageMask",
  "LoadImages",
  "LoadImageBatch",
]);

/**
 * Auto-detect image inputs in a ComfyUI workflow JSON.
 * This makes "Choose Image" appear for any workflow that actually needs an image.
 */
export function detectImageSlots(prompt: WorkflowPrompt): ImageSlot[] {
  const slots: ImageSlot[] = [];

  for (const [nodeId, node] of Object.entries(prompt || {})) {
    const classType = node?.class_type as string | undefined;
    const inputs = node?.inputs;

    if (!classType || !inputs) continue;

    // Strong signal: known image loader nodes
    if (IMAGE_NODE_TYPES.has(classType)) {
      if (typeof inputs.image === "string") {
        slots.push({ nodeId, inputKey: "image", classType });
      }
      continue;
    }

    // Fallback: inputs.image is a string AND class_type contains "LoadImage"
    // (covers custom variants)
    if (typeof inputs.image === "string" && /LoadImage/i.test(classType)) {
      slots.push({ nodeId, inputKey: "image", classType });
      continue;
    }
  }

  return slots;
}

/**
 * Inject an uploaded ComfyUI filename into all detected image slots.
 * Mutates a deep clone so we never write back to disk.
 */
export function injectImageIntoPrompt(
  prompt: WorkflowPrompt,
  uploadedFilename: string,
  slots?: ImageSlot[]
): WorkflowPrompt {
  const cloned: WorkflowPrompt = JSON.parse(JSON.stringify(prompt));
  const effectiveSlots = slots ?? detectImageSlots(cloned);

  for (const s of effectiveSlots) {
    if (cloned[s.nodeId]?.inputs) {
      cloned[s.nodeId].inputs[s.inputKey] = uploadedFilename;
    }
  }

  return cloned;
}
