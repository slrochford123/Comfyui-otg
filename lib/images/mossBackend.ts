import { mossBackend, mossSupport, type MossTarget } from "./mossImage";

export async function chooseMossBackend(target: MossTarget) {
  const baseUrl = mossBackend(target);
  const response = await fetch(`${baseUrl}/object_info`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`MOSS worker unavailable (${response.status}).`);
  const missing = mossSupport(await response.json(), target);
  if (missing) throw new Error(`MOSS on RTX ${target === "3090" ? "3090" : "5060 Ti"}: ${missing}`);
  return { baseUrl, label: target === "3090" ? "local-3090" : "image-primary", fallbackUsed: false };
}
