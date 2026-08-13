export function isSafeVoiceSampleUploadSegment(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 160 &&
    !trimmed.includes("..") &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\") &&
    /^[a-zA-Z0-9._-]+$/.test(trimmed)
  );
}
