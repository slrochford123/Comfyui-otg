/** Formatting-only normalization: no model rewriting and no silent abridgement. */
export function normalizeStorySpeechText(value: string) {
  return value.replace(/```(?:[^\n]*\n)?([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1").replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ").trim();
}
