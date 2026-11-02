/** Client-safe upload policy. Resolution is normalized, not rejected at 40 MP. */
export const MAX_LAB_IMAGE_BYTES = 512 * 1024 ** 2;
// A 2048-square RGBA PNG can slightly exceed 16 MiB with encoding overhead.
export const MAX_LAB_REFERENCE_BYTES = 20 * 1024 ** 2;
export const LAB_IMAGE_EDGE = 2048;
const imageExtensions:Record<string,string>={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",jpe:"image/jpeg",jfif:"image/jpeg",webp:"image/webp",gif:"image/gif",bmp:"image/bmp",tif:"image/tiff",tiff:"image/tiff",avif:"image/avif",heic:"image/heic",heif:"image/heif"};
export function labUploadMime(name:string,type:string) {
  const mime=type.split(";")[0].trim().toLowerCase();
  if(mime==="audio/x-wav")return "audio/wav";
  if(mime==="image/jpg"||mime==="image/pjpeg")return "image/jpeg";
  if(mime==="image/x-png")return "image/png";
  if(mime&&!["application/octet-stream","binary/octet-stream"].includes(mime))return mime;
  return imageExtensions[name.toLowerCase().split(".").pop()||""]||mime||"application/octet-stream";
}
