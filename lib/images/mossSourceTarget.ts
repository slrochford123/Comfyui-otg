/** Never attribute an old candidate to a default GPU when its source is unknown. */
export function mossSourceTarget(backend: string, imageUrl: string): "3090" | "5060ti" {
  if (/3090/.test(backend)) return "3090";
  if (/5060/.test(backend)) return "5060ti";
  // Exact fixed label returned by chooseMossBackend for the configured 5060.
  if (backend === "image-primary") return "5060ti";
  const source = new URL(imageUrl, "https://test.invalid").searchParams.get("comfyBaseUrl");
  if (source === "http://100.75.162.64:8188") return "3090";
  if (source === "http://100.98.212.116:8188") return "5060ti";
  throw Error("This older candidate has no recorded GPU source. Save a candidate with verified MOSS provenance.");
}
