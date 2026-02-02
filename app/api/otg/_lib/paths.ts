
import path from "node:path";

export const COMFY_BASE_URL = process.env.COMFY_BASE_URL || "http://127.0.0.1:8188";
export const COMFY_OUTPUT_DIR =
  process.env.COMFY_OUTPUT_DIR || "E:\\ComfyUI_windows_portable\\ComfyUI\\output";

export const OTG_DEVICE_OUTPUT_ROOT =
  process.env.OTG_DEVICE_OUTPUT_ROOT || path.join(COMFY_OUTPUT_DIR, "otg_devices");

export function safeJoin(base: string, ...parts: string[]) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(base, ...parts);
  if (!resolved.startsWith(resolvedBase)) {
    throw new Error("Path traversal blocked");
  }
  return resolved;
}

export function contentTypeForExt(ext: string) {
  const e = ext.toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  return "application/octet-stream";
}
