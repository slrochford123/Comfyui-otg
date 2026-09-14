export type H3InputMediaKind = "image" | "video" | "audio";

const EXTENSIONS: Record<H3InputMediaKind, readonly string[]> = {
  image: [
    ".png", ".jpg", ".jpeg", ".jpe", ".jfif", ".webp", ".gif", ".bmp",
    ".tif", ".tiff", ".avif", ".heic", ".heif", ".svg",
  ],
  video: [
    ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".mpeg", ".mpg",
    ".mpe", ".mpv", ".ts", ".mts", ".m2ts", ".3gp", ".3g2", ".ogv",
    ".wmv", ".asf", ".flv", ".f4v", ".vob", ".mxf",
  ],
  audio: [
    ".wav", ".wave", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".oga",
    ".opus", ".aif", ".aiff", ".aifc", ".au", ".snd", ".wma", ".ac3",
    ".eac3", ".amr", ".3ga", ".caf", ".mka", ".webm", ".mp4",
  ],
};

export const H3_MEDIA_ACCEPT: Record<H3InputMediaKind, string> = {
  image: ["image/*", ...EXTENSIONS.image].join(","),
  video: ["video/*", ...EXTENSIONS.video].join(","),
  audio: ["audio/*", ...EXTENSIONS.audio].join(","),
};

const GENERIC_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);

export function isAcceptedH3MediaFile(
  kind: H3InputMediaKind,
  file: Pick<File, "name" | "type">,
) {
  const mime = String(file.type || "").split(";", 1)[0].trim().toLowerCase();
  const extension = String(file.name || "").toLowerCase().match(/\.[a-z0-9]{1,10}$/)?.[0] || "";
  if (mime.startsWith(`${kind}/`)) return true;
  if (mime === "application/ogg") {
    return (kind === "audio" || kind === "video") && EXTENSIONS[kind].includes(extension);
  }
  if (!GENERIC_MIME_TYPES.has(mime)) return false;
  return EXTENSIONS[kind].includes(extension);
}

export function supportedH3MediaExtensions(kind: H3InputMediaKind) {
  return [...EXTENSIONS[kind]];
}
