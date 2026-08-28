const ALLOWED_VOICE_SAMPLE_EXTENSIONS = new Set([
  ".wav",
  ".mp3",
  ".m4a",
  ".flac",
  ".ogg",
]);

export function isAllowedVoiceSampleExtension(extension: string) {
  const ext = String(extension || "").trim().toLowerCase();
  return ALLOWED_VOICE_SAMPLE_EXTENSIONS.has(ext);
}

export function voiceSampleFileNameForExtension(extension: string) {
  const ext = String(extension || "").trim().toLowerCase();

  if (!isAllowedVoiceSampleExtension(ext)) {
    throw new Error("Unsupported audio extension. Use wav, mp3, m4a, flac, or ogg.");
  }

  return `sample${ext}`;
}
