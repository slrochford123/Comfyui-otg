/** Model inputs, not saved-upload/history quotas. Source image counts as input 1. */
export const QWEN_IMAGE_REFERENCE_LIMIT = 16;
export const FIBO_IMAGE_REFERENCE_LIMIT = 4;
export const IMAGE_UPLOAD_FIELDS = Array.from({length: QWEN_IMAGE_REFERENCE_LIMIT}, (_, i) => `image${String.fromCharCode(65 + i)}`);
export function imageReferenceLimit(engine: string) {
  return engine === "qwen" ? QWEN_IMAGE_REFERENCE_LIMIT : FIBO_IMAGE_REFERENCE_LIMIT;
}
export function assertReferenceCapacity(existing: number, added: number, maximum: number, label = "images") {
  if (!Number.isInteger(maximum) || maximum < 1 || existing + added > maximum) {
    throw new Error(`Choose at most ${Math.max(0, maximum - existing)} more ${label} (${existing}/${maximum} selected). Nothing was discarded.`);
  }
}
