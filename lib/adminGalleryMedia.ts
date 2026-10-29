import path from "node:path";

export type AdminGalleryMediaKind = "image" | "video" | "audio" | "other";
const TYPES: Record<string, [AdminGalleryMediaKind, string]> = {
  png: ["image", "image/png"], jpg: ["image", "image/jpeg"], jpeg: ["image", "image/jpeg"],
  webp: ["image", "image/webp"], gif: ["image", "image/gif"], avif: ["image", "image/avif"],
  bmp: ["image", "image/bmp"], tif: ["image", "image/tiff"], tiff: ["image", "image/tiff"],
  heic: ["image", "image/heic"], heif: ["image", "image/heif"], exr: ["image", "image/x-exr"],
  jxl: ["image", "image/jxl"], svg: ["image", "image/svg+xml"],
  mp4: ["video", "video/mp4"], webm: ["video", "video/webm"], mov: ["video", "video/quicktime"],
  mkv: ["video", "video/x-matroska"], avi: ["video", "video/x-msvideo"], m4v: ["video", "video/x-m4v"],
  mpeg: ["video", "video/mpeg"], mpg: ["video", "video/mpeg"],
  mp3: ["audio", "audio/mpeg"], wav: ["audio", "audio/wav"], flac: ["audio", "audio/flac"],
  ogg: ["audio", "audio/ogg"], opus: ["audio", "audio/ogg"], m4a: ["audio", "audio/mp4"],
  aac: ["audio", "audio/aac"], aiff: ["audio", "audio/aiff"],
};
export function adminGalleryMediaKind(name: string): AdminGalleryMediaKind {
  return TYPES[path.extname(name).slice(1).toLowerCase()]?.[0] || "other";
}
export function adminGalleryMime(name: string): string {
  return TYPES[path.extname(name).slice(1).toLowerCase()]?.[1] || "application/octet-stream";
}
export function adminGalleryAttachment(name: string) {
  const filename = path.posix.basename(name.replace(/\\/g, "/"));
  const ascii = filename.replace(/[^\x20-\x7e]|["\\;]/g, "_") || "download";
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
