export type AssetImageModelId =
  | "ernie-image"
  | "z-image"
  | "krea-2"
  | "boogu"
  | "mage-flow"
  | "qwen-image-2-1";

export type AssetImageModel = {
  id: AssetImageModelId;
  label: string;
  workflowFile: string;
};

export const ASSET_IMAGE_MODELS: readonly AssetImageModel[] = [
  {
    id: "ernie-image",
    label: "Ernie Image",
    workflowFile:
      "workflows/characters/create/image_ernie_image_turbo.json",
  },
  {
    id: "z-image",
    label: "Z Image",
    workflowFile:
      "workflows/characters/create/image_z_image_turbo.json",
  },
  {
    id: "krea-2",
    label: "Krea 2",
    workflowFile:
      "workflows/characters/create/image_krea2_turbo_t2i.json",
  },
  {
    id: "boogu",
    label: "Boogu",
    workflowFile:
      "workflows/characters/create/image_boogu_image_0_1_turbo_t2i.json",
  },
  {
    id: "mage-flow",
    label: "Mage Flow",
    workflowFile:
      "workflows/characters/create/image_mage_flow_turbo_t2i_int8.json",
  },
  {
    id: "qwen-image-2-1",
    label: "Qwen Image 2.1",
    workflowFile:
      "workflows/characters/create/image_qwen_image_2_1_t2i.json",
  },
] as const;

export function assetImageModel(
  id: string,
): AssetImageModel | null {
  return (
    ASSET_IMAGE_MODELS.find(
      (model) => model.id === id,
    ) ?? null
  );
}
