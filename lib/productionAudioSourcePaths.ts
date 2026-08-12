import path from "node:path";

import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";

export type ProductionAudioSourcePathOptions = {
  dataRoot?: string;
  configuredGalleryDir?: string;
  galleryProfile?: string;
};

function uniqueResolvedPaths(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;

    const resolved = path.resolve(raw);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(resolved);
  }

  return output;
}

export function productionAudioGalleryRoots(
  ownerKey: string,
  options: ProductionAudioSourcePathOptions = {},
): string[] {
  const dataRoot = path.resolve(options.dataRoot || OTG_DATA_ROOT);
  const configuredGalleryDir = String(options.configuredGalleryDir || "").trim();
  const galleryProfile = safeSegment(options.galleryProfile || "test_profile");
  const owner = safeSegment(ownerKey || "local");

  return uniqueResolvedPaths([
    path.join(dataRoot, "user_galleries", owner),
    configuredGalleryDir || null,
    path.join(dataRoot, "user_galleries", galleryProfile),
    path.join(dataRoot, "user_galleries", "test_profile"),
    path.join(dataRoot, "user_galleries", "default"),
  ]);
}

export function productionAudioProductionsRoot(
  dataRoot = OTG_DATA_ROOT,
): string {
  return path.join(path.resolve(dataRoot), "productions");
}

export function productionAudioAnalysisRoot(
  dataRoot = OTG_DATA_ROOT,
): string {
  return path.join(path.resolve(dataRoot), "production_audio_analysis");
}
