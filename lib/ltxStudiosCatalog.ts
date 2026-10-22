import officialRequirements from "./ltxStudiosOfficialRequirements.json";
export type LtxStudioCategory = "generation" | "motion" | "compositing" | "restoration" | "color";
export type LtxStudioWorkflowKind = "standard" | "ic-lora";

export type LtxStudioCatalogEntry = {
  id: string;
  name: string;
  category: LtxStudioCategory;
  workflowKind: LtxStudioWorkflowKind;
  description: string;
  recommendedStrength: number;
  requiresSourceVideo: boolean;
  compatibility: string[];
  status: "cataloged" | "ready" | "needs-workflow";
  assetNames: string[];
  sourceUrl: string;
  notes: string[];
};

const sourceUrl = "https://github.com/Lightricks/LTX-Desktop/blob/main/docs/models-and-loras.md";

export const LTX_STUDIOS_CATALOG: LtxStudioCatalogEntry[] = [
  ["ingredients", "Ingredients", "compositing", "ic-lora", "Guide a scene with ingredient images and preserve their visual identity.", .8, true],
  ["colorization", "Colorization", "color", "standard", "Add color to monochrome footage while preserving motion and structure.", .8, true],
  ["slow-motion-control", "Slow Motion Control", "motion", "standard", "Create a controlled slow-motion interpretation of the source motion.", .7, true],
  ["cinemagraph", "Cinemagraph", "motion", "standard", "Hold selected regions while keeping a chosen motion area alive.", .8, true],
  ["clean-plate", "Clean Plate", "compositing", "ic-lora", "Remove a foreground element and reconstruct the background plate.", .8, true],
  ["day-to-night", "Day-to-Night", "color", "standard", "Relight a daytime shot into a coherent night-time look.", .8, true],
  ["water-simulation", "Water Simulation", "motion", "standard", "Add controlled water movement and surface behavior to a shot.", .7, true],
  ["decompression", "Decompression", "restoration", "standard", "Reduce compression artifacts and recover cleaner visual detail.", .7, true],
  ["deblur", "Deblur", "restoration", "standard", "Recover detail from motion-blurred or soft source footage.", .7, true],
  ["restore", "Restore", "restoration", "standard", "Restore damaged or degraded footage with conservative conditioning.", .7, true],
  ["refine-details", "Refine Details", "restoration", "standard", "Improve local texture and fine detail without changing composition.", .6, true],
  ["sdr-to-hdr", "SDR-to-HDR", "color", "standard", "Expand a standard-dynamic-range source toward an HDR-style result.", .7, true],
  ["alpha-gen", "Alpha Gen", "compositing", "ic-lora", "Extract a foreground alpha matte from a source video using empty text conditioning.", 1, true],
  ["layout-to-render", "Layout-to-Render", "generation", "ic-lora", "Turn a layout/reference into a rendered shot while retaining composition.", .85, true],
].map(([id, name, category, workflowKind, description, recommendedStrength, requiresSourceVideo]) => ({
  id, name, category, workflowKind: id === "slow-motion-control" || id === "cinemagraph" ? "standard" : "ic-lora", description, recommendedStrength, requiresSourceVideo: id !== "ingredients" && id !== "cinemagraph" && id !== "slow-motion-control",
  compatibility: ["LTX 2.5"], status: "needs-workflow", assetNames: officialRequirements.filter(row=>row.id===id).map(row=>row.file), sourceUrl: officialRequirements.find(row=>row.id===id)?.source || sourceUrl,
  notes: officialRequirements.filter(row=>row.id===id).flatMap(row=>[`${row.repository} / ${row.file}`, `Download: ${row.downloadBytes} bytes; ${row.license}.`,...row.instructions.map(item=>`${item.title}: ${Array.isArray(item.body)?item.body.join(" "):item.body}`)]),
} as LtxStudioCatalogEntry));

export function validateLtxStudiosCatalog(entries = LTX_STUDIOS_CATALOG) {
  if (entries.length !== 14) throw new Error(`Expected 14 LTX Studios entries, received ${entries.length}.`);
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) throw new Error("LTX Studios catalog contains duplicate IDs.");
  return entries;
}
