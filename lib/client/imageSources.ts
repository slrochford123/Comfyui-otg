// The native wrapper recognizes this MIME hint. Browsers fall back to Files.
export const PHONE_STORAGE_MIME = "application/x-otg-phone-storage";

const IMAGE_EXTENSIONS = /^(?:avif|bmp|gif|heic|heif|ico|jfif|jpe?g|png|svg|tiff?|webp)$/i;
const splitAccept = (accept: string) => accept.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);

export function acceptsImages(accept: string): boolean {
  const types = splitAccept(accept);
  return !types.length || types.some(type => type === "*/*" || type.startsWith("image/") || (type.startsWith(".") && IMAGE_EXTENSIONS.test(type.slice(1))));
}

export function phoneStorageAccept(accept: string): string {
  return `${accept || "*/*"},${PHONE_STORAGE_MIME}`;
}

export function matchesOriginalAccept(file: Pick<File, "name" | "type">, accept: string): boolean {
  const types = splitAccept(accept);
  const mime = file.type.toLowerCase();
  const extension = file.name.split(".").pop() || "";
  return !types.length || types.some(type => {
    if (type === "*/*") return true;
    if (type.startsWith(".")) return file.name.toLowerCase().endsWith(type);
    if (type === "image/*" && !mime) return IMAGE_EXTENSIONS.test(extension);
    return type.endsWith("/*") ? mime.startsWith(type.slice(0, -1)) : mime === type;
  });
}
