"use client";

function otgPickerAssetDebugTextV36BPJ1(asset: any): string {
  return [
    asset?.id,
    asset?.key,
    asset?.type,
    asset?.kind,
    asset?.category,
    asset?.name,
    asset?.label,
    asset?.title,
    asset?.source,
    asset?.sourceLabel,
    asset?.origin,
    asset?.originLabel,
    asset?.debugSource,
    asset?.library,
    asset?.collection,
    asset?.group,
    asset?.description,
    asset?.workflowImage,
    asset?.workflowImagePath,
    asset?.workflowImageUrl,
    asset?.imagePath,
    asset?.previewImagePath,
    asset?.url,
    asset?.previewUrl,
    asset?.characterCardPath,
    asset?.characterCardWorkflowImagePath,
    asset?.defaultCharacterImagePath,
    asset?.backgroundRemovedDefaultImagePath,
  ]
    .map((value) => String(value || ""))
    .join(" ")
    .toLowerCase();
}

function otgIsSavedCharacterPickerAssetV36BPJ1(asset: any): boolean {
  const type = String(asset?.type || asset?.kind || asset?.category || "").toLowerCase();

  const text = otgPickerAssetDebugTextV36BPJ1(asset);
  const hasSavedCharacterSource =
    text.includes("characters.items") ||
    text.includes("characters-list") ||
    text.includes("saved characters") ||
    text.includes("character library");

  const hasSavedCharacterFields =
    Boolean(asset?.characterCardPath) ||
    Boolean(asset?.characterCardWorkflowImagePath) ||
    Boolean(asset?.defaultCharacterImagePath) ||
    Boolean(asset?.backgroundRemovedDefaultImagePath);

  const hasTransientSceneSource =
    text.includes("localstorage") ||
    text.includes("otg-qwen-scene-builder") ||
    text.includes(".passes[") ||
    text.includes("passes[") ||
    text.includes("response.references") ||
    text.includes("response.output") ||
    text.includes("outputimage") ||
    text.includes("scene-pass") ||
    text.includes("locked base") ||
    text.includes("comfyui_");

  if (hasTransientSceneSource && !hasSavedCharacterSource) return false;
  if (hasSavedCharacterSource || hasSavedCharacterFields) return true;
  if (type && type !== "character") return false;

  return false;
}


function otgIsAllowedPickerAssetV36BPJ1(asset: any, pickerType: unknown): boolean {
  const picker = String(pickerType || "").toLowerCase();
  if (picker !== "character") return true;
  return otgIsSavedCharacterPickerAssetV36BPJ1(asset);
}

function otgFilterPickerAssetsV36BPJ1<T extends any>(assets: T[], pickerType: unknown): T[] {
  if (String(pickerType || "").toLowerCase() !== "character") return assets;
  return assets.filter((asset) => otgIsSavedCharacterPickerAssetV36BPJ1(asset));
}



function otgComfySafeImageSrcV36BPI2(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(data:image\/|blob:)/i.test(raw)) return raw;
  if (raw.startsWith("/api/otg/local-image")) return raw;
  if (raw.startsWith("/api/comfy/view")) return raw;
  if (raw.startsWith("/api/comfy/history-image")) return raw;
  if (raw.startsWith("/view?")) return `/api/comfy${raw}`;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.pathname === "/view" || url.pathname.endsWith("/view")) {
        const filename = url.searchParams.get("filename") || "";
        const type = url.searchParams.get("type") || "output";
        const subfolder = url.searchParams.get("subfolder") || "";
        const params = new URLSearchParams();
        if (filename) params.set("filename", filename);
        params.set("type", type);
        if (subfolder) params.set("subfolder", subfolder);
        return `/api/comfy/view?${params.toString()}`;
      }
    } catch {
      return raw;
    }

    return raw;
  }

  if (/^\/[A-Za-z]:[\\/]/.test(raw)) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw.slice(1))}`;
  }

  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.includes("\\data\\") || raw.includes("/data/")) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw)}`;
  }

  if (raw.startsWith("/")) return raw;

  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(raw)) {
    return `/api/comfy/view?filename=${encodeURIComponent(raw)}&type=output`;
  }

  return raw.replace(/\\/g, "/");
}




function otgSceneResultImageUrlV36BPH1(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(data:image\/|blob:)/i.test(raw)) return raw;
  if (raw.startsWith("/api/otg/local-image")) return raw;
  if (raw.startsWith("/api/comfy/history-image")) return raw;
  if (raw.startsWith("/api/comfy/view")) return raw;
  if (raw.startsWith("/view?")) return `/api/comfy${raw}`;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.pathname === "/view" || url.pathname.endsWith("/view")) {
        const filename = url.searchParams.get("filename") || "";
        const type = url.searchParams.get("type") || "output";
        const subfolder = url.searchParams.get("subfolder") || "";
        const proxy = new URLSearchParams();
        if (filename) proxy.set("filename", filename);
        proxy.set("type", type);
        if (subfolder) proxy.set("subfolder", subfolder);
        return `/api/comfy/view?${proxy.toString()}`;
      }
    } catch {
      // Fall through to returning raw URL.
    }

    return raw;
  }

  if (/^\/[A-Za-z]:[\\/]/.test(raw)) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw.slice(1))}`;
  }

  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.includes("\\data\\") || raw.includes("/data/")) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw)}`;
  }

  if (raw.startsWith("/")) return raw;

  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(raw)) {
    return `/api/comfy/view?filename=${encodeURIComponent(raw)}&type=output`;
  }

  return raw.replace(/\\/g, "/");
}

function otgAssetDisplayUrlV36BPA(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(data:image\/|blob:|https?:\/\/)/i.test(raw)) return raw;
  if (raw.startsWith("/api/otg/local-image")) return raw;

  if (/^\/[A-Za-z]:[\\/]/.test(raw)) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw.slice(1))}`;
  }

  if (raw.startsWith("/")) return raw;

  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.includes("\\data\\") || raw.includes("/data/")) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw)}`;
  }

  return raw.replace(/\\/g, "/");
}

function otgCharacterPreviewPathV36BPA(asset: any): string {
  return String(
    asset?.defaultCharacterPreviewImagePath ||
      asset?.defaultCharacterImagePath ||
      asset?.backgroundRemovedDefaultImagePath ||
      asset?.previewImagePath ||
      asset?.imagePath ||
      asset?.previewUrl ||
      asset?.url ||
      asset?.imageUrl ||
      asset?.displayImage ||
      asset?.thumbnailUrl ||
      asset?.characterCardPreviewImagePath ||
      asset?.characterCardPath ||
      asset?.characterCardWorkflowImagePath ||
      asset?.workflowImage ||
      asset?.workflowImagePath ||
      asset?.workflowImageUrl ||
      "",
  ).trim();
}

function otgWorkflowImagePathV36BPA(asset: any) {
  return (
    asset?.characterCardWorkflowImagePath ||
    asset?.characterCardPath ||
    asset?.workflowImage ||
    asset?.workflowImagePath ||
    asset?.imagePath ||
    asset?.url ||
    asset?.imageUrl ||
    ""
  );
}



function otgDisplayImageUrlV36BP8(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(data:image\/|blob:|https?:\/\/)/i.test(raw)) return raw;
  if (raw.startsWith("/api/otg/local-image")) return raw;
  if (/^\/[A-Za-z]:[\\/]/.test(raw)) return `/api/otg/local-image?path=${encodeURIComponent(raw.slice(1))}`;
  if (raw.startsWith("/")) return raw;
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.includes("\\data\\") || raw.includes("/data/")) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw)}`;
  }
  return raw.replace(/\\/g, "/");
}


function otgDisplayImageUrlV36BP6(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(data:image\/|blob:|https?:\/\/)/i.test(raw)) return raw;
  if (raw.startsWith("/api/otg/local-image")) return raw;

  if (/^\/[A-Za-z]:[\\/]/.test(raw)) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw.slice(1))}`;
  }

  if (raw.startsWith("/")) return raw;

  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.includes("\\data\\") || raw.includes("/data/")) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw)}`;
  }

  return raw.replace(/\\/g, "/");
}

function characterDisplayImagePathV36BP6(character: any) {
  return (
    character?.defaultCharacterPreviewImagePath ||
    character?.defaultCharacterImagePath ||
    character?.backgroundRemovedDefaultImagePath ||
    character?.previewImagePath ||
    character?.imagePath ||
    character?.characterCardPreviewImagePath ||
    character?.characterCardPath ||
    character?.characterCardWorkflowImagePath ||
    ""
  );
}



import { useEffect, useMemo, useState } from "react";

type SceneAsset = {
  id: string;
  type: "background" | "character" | "object" | "base";
  name: string;
  description: string;
  workflowImage: string;
  previewUrl: string;
  source: string;
  locked?: boolean;
};

type ScenePass = {
  id: string;
  prompt: string;
  negativePrompt: string;
  references: SceneAsset[];
  status: "idle" | "submitting" | "complete" | "error";
  error?: string;
  sentPrompt?: string;
  resultImageUrl?: string;
  resultWorkflowImage?: string;
  response?: unknown;
};

type SceneRecord = {
  id: string;
  name: string;
  inputSceneImage?: string;
  passes: ScenePass[];
  completedImageUrl?: string;
  completedWorkflowImage?: string;
};

type ManualReferenceForm = {
  type: SceneAsset["type"];
  name: string;
  workflowImage: string;
  previewUrl: string;
  description: string;
};

const STORAGE_KEY = "otg-qwen-scene-builder-v36bo5b";
const MAX_SCENES = 8;
const MAX_PASSES = 10;
const MAX_REFERENCES = 3;

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyPass(index: number, references: SceneAsset[] = []): ScenePass {
  return {
    id: uid(`pass-${index}`),
    prompt: "",
    negativePrompt: "low quality, blurry, distorted, deformed, bad anatomy",
    references,
    status: "idle",
  };
}

function createInitialScenes(): SceneRecord[] {
  return Array.from({ length: MAX_SCENES }, (_, index) => ({
    id: `scene-${index + 1}`,
    name: `Scene ${index + 1}`,
    inputSceneImage: "",
    passes: [emptyPass(1)],
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return "";
}

function inferType(record: Record<string, unknown>, fallback: SceneAsset["type"]): SceneAsset["type"] {
  const haystack = [
    firstString(record, ["type", "kind", "category", "role", "assetType", "sourceType"]),
    firstString(record, ["label", "name", "title"]),
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("background") || haystack.includes("plate") || haystack.includes("scene bg")) return "background";
  if (haystack.includes("object") || haystack.includes("prop") || haystack.includes("asset")) return "object";
  if (haystack.includes("base")) return "base";
  if (haystack.includes("character") || haystack.includes("char")) return "character";
  return fallback;
}

function assetImageFromRecord(record: Record<string, unknown>) {
  return firstString(record, [
    "characterCardWorkflowImagePath",
    "characterCardPath",
    "characterCardImagePath",
    "workflowImage",
    "workflowImagePath",
    "workflowImageUrl",
    "sourceWorkflowImageV36AF",
    "plateWorkflowImageV36AF",
    "fileName",
    "image",
    "imagePath",
    "imageUrl",
    "url",
    "src",
    "previewUrl",
    "displayImage",
    "sourceDisplayImageV36AF",
  ]);
}

function previewImageFromRecord(record: Record<string, unknown>, fallback: string) {
  return (
    firstString(record, [
      "defaultCharacterPreviewImagePath",
      "defaultCharacterImagePath",
      "backgroundRemovedDefaultImagePath",
      "previewUrl",
      "displayImage",
      "sourceDisplayImageV36AF",
      "thumbnailUrl",
      "thumbnail",
      "imageUrl",
      "imagePath",
      "url",
      "src",
    ]) || fallback
  );
}

function descriptionFromRecord(record: Record<string, unknown>) {
  return firstString(record, [
    "description",
    "completeDescription",
    "lockedDescription",
    "identityBlock",
    "promptBlock",
    "prompt",
    "details",
    "summary",
  ]);
}

function collectAssetsFromProps(props: Record<string, unknown>) {
  const assets: SceneAsset[] = [];
  const seenObjects = new Set<object>();
  const seenImages = new Set<string>();

  function visit(value: unknown, source: string, depth: number, fallbackType: SceneAsset["type"]) {
    if (depth > 6 || assets.length >= 120) return;
    if (!value || typeof value !== "object") return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${source}[${index}]`, depth + 1, fallbackType));
      return;
    }

    const record = value as Record<string, unknown>;
    const image = assetImageFromRecord(record);
    const type = inferType(record, fallbackType);
    const name = firstString(record, ["name", "title", "label", "displayName", "characterName"]) || `${type} asset`;
    const description = descriptionFromRecord(record);
    const previewUrl = previewImageFromRecord(record, image);

    if (image && !seenImages.has(image)) {
      seenImages.add(image);
      assets.push({
        id: firstString(record, ["id", "_id", "uuid", "key"]) || `${source}-${assets.length}`,
        type,
        name,
        description,
        workflowImage: image,
        previewUrl,
        source,
      });
    }

    for (const [key, child] of Object.entries(record)) {
      const lowerKey = key.toLowerCase();
      const nextFallback =
        lowerKey.includes("background") || lowerKey.includes("plate")
          ? "background"
          : lowerKey.includes("object") || lowerKey.includes("prop")
            ? "object"
            : lowerKey.includes("character") || lowerKey.includes("card")
              ? "character"
              : fallbackType;

      if (typeof child === "object" && child !== null) visit(child, `${source}.${key}`, depth + 1, nextFallback);
    }
  }

  visit(props, "props", 0, "character");
  return assets;
}

function normalizeImageForPreview(value: string) {
  if (!value) return "";
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.includes("\\data\\") || value.includes("/data/")) {
    return otgAssetDisplayUrlV36BPA(value);
  }
  if (/^https?:\/\//i.test(value) || value.startsWith("/") || value.startsWith("data:")) return value;
  return `/api/comfy/view?filename=${encodeURIComponent(value)}&type=output`;
}

function normalizeImageForWorkflow(value: string) {
  if (!value) return "";
  try {
    if (/^https?:\/\//i.test(value)) {
      const parsed = new URL(value);
      const filename = parsed.searchParams.get("filename");
      if (filename) return filename;
    }
  } catch {
    // Keep raw value.
  }
  return value;
}

function referenceKey(ref: SceneAsset) {
  return `${ref.type}:${normalizeImageForWorkflow(ref.workflowImage).toLowerCase()}`;
}

function getReferenceLimit(pass: ScenePass) {
  const lockedCount = pass.references.filter((ref) => ref.locked).length;
  return lockedCount ? MAX_REFERENCES : MAX_REFERENCES;
}

function canAddReference(pass: ScenePass) {
  return pass.references.length < getReferenceLimit(pass);
}

function makeInputSceneReferenceV36BPL1(scene: SceneRecord): SceneAsset | null {
  const workflowImage = normalizeImageForWorkflow(scene.inputSceneImage || "");
  if (!workflowImage) return null;

  return {
    id: `input-scene-${scene.id}`,
    type: "base",
    name: "Input scene image",
    description: "User-provided input image for this scene.",
    workflowImage,
    previewUrl: normalizeImageForPreview(workflowImage),
    source: "scene-input",
    locked: true,
  };
}

function makeBaseReferenceFromPass(pass: ScenePass): SceneAsset | null {
  const workflowImage = normalizeImageForWorkflow(pass.resultWorkflowImage || "");
  const previewUrl = pass.resultImageUrl || (workflowImage ? normalizeImageForPreview(workflowImage) : "");

  if (!workflowImage && !previewUrl) return null;

  return {
    id: uid("locked-base"),
    type: "base",
    name: "Locked base from previous pass",
    description: "Locked base image from the previous prompt pass.",
    workflowImage: workflowImage || previewUrl,
    previewUrl,
    source: "previous-pass",
    locked: true,
  };
}

type AssetBridgeEndpointV36BO5C = {
  label: string;
  url: string;
  fallbackType: SceneAsset["type"];
};

const ASSET_BRIDGE_ENDPOINTS_V36BO5C: AssetBridgeEndpointV36BO5C[] = [
  { label: "characters", url: "/api/characters", fallbackType: "character" },
  { label: "characters-list", url: "/api/characters/list", fallbackType: "character" },
  { label: "character-cards", url: "/api/character-cards", fallbackType: "character" },
  { label: "production-characters", url: "/api/production/characters", fallbackType: "character" },
  { label: "backgrounds", url: "/api/backgrounds", fallbackType: "background" },
  { label: "background-gallery", url: "/api/background-gallery", fallbackType: "background" },
  { label: "gallery-backgrounds", url: "/api/gallery/backgrounds", fallbackType: "background" },
  { label: "gallery", url: "/api/gallery", fallbackType: "object" },
  { label: "assets", url: "/api/assets", fallbackType: "object" },
  { label: "production-assets", url: "/api/production/assets", fallbackType: "object" },
];

function assetBridgeFirstStringV36BO5C(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return "";
}

function assetBridgeNestedStringV36BO5C(record: Record<string, unknown>, paths: string[][]) {
  for (const parts of paths) {
    let current: unknown = record;
    for (const part of parts) {
      if (!isRecord(current)) {
        current = undefined;
        break;
      }
      current = current[part];
    }
    const value = asString(current);
    if (value) return value;
  }
  return "";
}

function assetBridgeInferTypeV36BO5C(record: Record<string, unknown>, fallbackType: SceneAsset["type"], source: string): SceneAsset["type"] {
  const haystack = [
    source,
    assetBridgeFirstStringV36BO5C(record, ["type", "kind", "category", "role", "assetType", "sourceType", "slotType"]),
    assetBridgeFirstStringV36BO5C(record, ["label", "name", "title", "displayName", "characterName"]),
  ].join(" ").toLowerCase();

  if (haystack.includes("background") || haystack.includes("plate") || haystack.includes("scene bg") || haystack.includes("bg:")) return "background";
  if (haystack.includes("object") || haystack.includes("prop") || haystack.includes("misc") || haystack.includes("asset")) return "object";
  if (haystack.includes("base") || haystack.includes("previous pass")) return "base";
  if (haystack.includes("character") || haystack.includes("char") || haystack.includes("complete description")) return "character";
  return fallbackType;
}

function assetBridgeImageFromRecordV36BO5C(record: Record<string, unknown>) {
  return (
    assetBridgeFirstStringV36BO5C(record, [
      "characterCardWorkflowImagePath",
      "characterCardPath",
      "characterCardImagePath",
      "workflowImage",
      "workflowImagePath",
      "workflowImageUrl",
      "sourceWorkflowImageV36AF",
      "plateWorkflowImageV36AF",
      "fileName",
      "filename",
      "image",
      "imagePath",
      "imageUrl",
      "url",
      "src",
      "defaultCharacterPreviewImagePath",
      "defaultCharacterImagePath",
      "backgroundRemovedDefaultImagePath",
      "previewUrl",
      "displayImage",
      "sourceDisplayImageV36AF",
    ]) ||
    assetBridgeNestedStringV36BO5C(record, [
      ["image", "filename"],
      ["image", "fileName"],
      ["image", "url"],
      ["image", "path"],
      ["workflow", "image"],
      ["workflow", "filename"],
      ["preview", "filename"],
      ["preview", "url"],
      ["file", "filename"],
      ["file", "name"],
    ])
  );
}

function assetBridgePreviewFromRecordV36BO5C(record: Record<string, unknown>, fallback: string) {
  return (
    assetBridgeFirstStringV36BO5C(record, [
      "defaultCharacterPreviewImagePath",
      "defaultCharacterImagePath",
      "backgroundRemovedDefaultImagePath",
      "previewUrl",
      "displayImage",
      "sourceDisplayImageV36AF",
      "thumbnailUrl",
      "thumbnail",
      "imageUrl",
      "imagePath",
      "url",
      "src",
    ]) ||
    assetBridgeNestedStringV36BO5C(record, [
      ["preview", "url"],
      ["thumbnail", "url"],
      ["image", "url"],
      ["image", "src"],
    ]) ||
    fallback
  );
}

function assetBridgeDescriptionFromRecordV36BO5C(record: Record<string, unknown>) {
  return (
    assetBridgeFirstStringV36BO5C(record, [
      "description",
      "completeDescription",
      "lockedDescription",
      "identityBlock",
      "promptBlock",
      "continuityBlock",
      "globalPromptDescription",
      "promptReadyDescription",
      "prompt",
      "details",
      "summary",
    ]) ||
    assetBridgeNestedStringV36BO5C(record, [
      ["completeDescription", "prompt"],
      ["completeDescription", "description"],
      ["identity", "description"],
      ["identity", "prompt"],
      ["lockedIdentity", "description"],
      ["card", "description"],
      ["character", "description"],
      ["metadata", "description"],
    ])
  );
}

function assetBridgeNameFromRecordV36BO5C(record: Record<string, unknown>, fallback: string) {
  return (
    assetBridgeFirstStringV36BO5C(record, ["name", "title", "label", "displayName", "characterName", "assetName", "fileName", "filename"]) ||
    assetBridgeNestedStringV36BO5C(record, [
      ["character", "name"],
      ["card", "name"],
      ["metadata", "name"],
      ["file", "name"],
      ["image", "filename"],
    ]) ||
    fallback
  );
}

function collectAssetBridgeAssetsFromUnknownV36BO5C(value: unknown, source: string, fallbackType: SceneAsset["type"], maxAssets = 160) {
  const assets: SceneAsset[] = [];
  const seenObjects = new Set<object>();
  const seenImages = new Set<string>();

  function visit(current: unknown, currentSource: string, depth: number, currentFallback: SceneAsset["type"]) {
    if (depth > 7 || assets.length >= maxAssets) return;
    if (!current || typeof current !== "object") return;
    if (seenObjects.has(current)) return;
    seenObjects.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentSource}[${index}]`, depth + 1, currentFallback));
      return;
    }

    const record = current as Record<string, unknown>;
    const type = assetBridgeInferTypeV36BO5C(record, currentFallback, currentSource);
    const rawImage = assetBridgeImageFromRecordV36BO5C(record);
    const workflowImage = normalizeImageForWorkflow(rawImage);
    const name = assetBridgeNameFromRecordV36BO5C(record, `${type} asset`);
    const description = assetBridgeDescriptionFromRecordV36BO5C(record) || (type === "background" ? "" : `${name}.`);
    const preview = assetBridgePreviewFromRecordV36BO5C(record, rawImage);
    const previewUrl = preview ? normalizeImageForPreview(preview) : normalizeImageForPreview(workflowImage);

    if (workflowImage) {
      const imageKey = `${type}:${workflowImage.toLowerCase()}`;
      if (!seenImages.has(imageKey)) {
        seenImages.add(imageKey);
        assets.push({
          id: assetBridgeFirstStringV36BO5C(record, ["id", "_id", "uuid", "key", "assetId", "characterId"]) || `${currentSource}-${assets.length}`,
          type,
          name,
          description,
          workflowImage,
          previewUrl,
          source: currentSource,
        });
      }
    }

    for (const [key, child] of Object.entries(record)) {
      if (!child || typeof child !== "object") continue;
      const lowerKey = key.toLowerCase();
      const nextFallback =
        lowerKey.includes("background") || lowerKey.includes("plate")
          ? "background"
          : lowerKey.includes("object") || lowerKey.includes("prop") || lowerKey.includes("asset")
            ? "object"
            : lowerKey.includes("character") || lowerKey.includes("card")
              ? "character"
              : currentFallback;

      visit(child, `${currentSource}.${key}`, depth + 1, nextFallback);
    }
  }

  visit(value, source, 0, fallbackType);
  return assets;
}

function collectLocalStorageAssetsV36BO5C() {
  if (typeof window === "undefined") return [];

  const assets: SceneAsset[] = [];
  const keyPattern = /(character|background|gallery|asset|production|storyboard|otg|card|scene)/i;

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index) || "";
    if (!keyPattern.test(key)) continue;

    const raw = window.localStorage.getItem(key);
    if (!raw || raw.length > 8000000) continue;

    try {
      const parsed = JSON.parse(raw) as unknown;
      const fallbackType: SceneAsset["type"] = /background/i.test(key) ? "background" : /object|prop|asset/i.test(key) ? "object" : "character";
      assets.push(...collectAssetBridgeAssetsFromUnknownV36BO5C(parsed, `localStorage.${key}`, fallbackType, 120));
    } catch {
      // Ignore non-JSON localStorage.
    }
  }

  return assets;
}

async function fetchAssetBridgeEndpointV36BO5C(endpoint: AssetBridgeEndpointV36BO5C) {
  const response = await fetch(endpoint.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${endpoint.label}: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error(`${endpoint.label}: non-JSON response`);
  const data = (await response.json()) as unknown;
  return collectAssetBridgeAssetsFromUnknownV36BO5C(data, endpoint.label, endpoint.fallbackType, 160);
}

function dedupeAssetsV36BO5C(assets: SceneAsset[]) {
  const seen = new Set<string>();
  const result: SceneAsset[] = [];

  for (const asset of assets) {
    const workflowImage = normalizeImageForWorkflow(asset.workflowImage);
    if (!workflowImage) continue;

    const key = `${asset.type}:${workflowImage.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      ...asset,
      workflowImage,
      previewUrl: asset.previewUrl || normalizeImageForPreview(workflowImage),
      description: asset.description || (asset.type === "background" ? "" : `${asset.name}.`),
    });
  }

  return result;
}

function loadSavedScenes() {
  if (typeof window === "undefined") return createInitialScenes();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialScenes();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return createInitialScenes();
    const scenes = parsed.filter(isRecord).slice(0, MAX_SCENES) as unknown as SceneRecord[];
    if (!scenes.length) return createInitialScenes();
    while (scenes.length < MAX_SCENES) {
      scenes.push({ id: `scene-${scenes.length + 1}`, name: `Scene ${scenes.length + 1}`, passes: [emptyPass(1)] });
    }
    return scenes.map((scene, index) => ({
      id: scene.id || `scene-${index + 1}`,
      name: scene.name || `Scene ${index + 1}`,
      completedImageUrl: scene.completedImageUrl,
      completedWorkflowImage: scene.completedWorkflowImage,
      inputSceneImage: scene.inputSceneImage || "",
      passes: Array.isArray(scene.passes) && scene.passes.length ? scene.passes.slice(0, MAX_PASSES) : [emptyPass(1)],
    }));
  } catch {
    return createInitialScenes();
  }
}

const ADD_TO_FIRST_IMAGE_LINE_V36BPK1 = "add to first image";

function ensureAddToFirstImagePromptV36BPK1(prompt: string, oneBasedPassIndex: number) {
  const clean = prompt.trim();
  if (oneBasedPassIndex <= 1 || !clean) return clean;

  const firstLine = clean.split(/\r?\n/, 1)[0]?.trim().toLowerCase() || "";
  if (firstLine === ADD_TO_FIRST_IMAGE_LINE_V36BPK1) return clean;

  return `${ADD_TO_FIRST_IMAGE_LINE_V36BPK1}\n${clean}`;
}


function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export default function QwenSceneBuilderPanel(props: Record<string, unknown>) {
  const propDetectedAssets = useMemo(() => collectAssetsFromProps(props), [props]);
  const [bridgeAssets, setBridgeAssets] = useState<SceneAsset[]>([]);
  const [assetBridgeStatus, setAssetBridgeStatus] = useState("Scanning project assets...");
  const [assetBridgeErrors, setAssetBridgeErrors] = useState<string[]>([]);
  const [pickerType, setPickerType] = useState<SceneAsset["type"] | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [scenes, setScenes] = useState<SceneRecord[]>(() => loadSavedScenes());
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [selectedPassIndex, setSelectedPassIndex] = useState(0);
  const [manual, setManual] = useState<ManualReferenceForm>({
    type: "character",
    name: "",
    workflowImage: "",
    previewUrl: "",
    description: "",
  });

  const detectedAssets = useMemo(() => dedupeAssetsV36BO5C([...propDetectedAssets, ...bridgeAssets]), [bridgeAssets, propDetectedAssets]);
  const selectedScene = scenes[selectedSceneIndex] || scenes[0];
  const selectedPass = selectedScene?.passes[selectedPassIndex] || selectedScene?.passes[0];

  const filteredDetectedAssets = useMemo(() => {
    const search = assetSearch.trim().toLowerCase();
    return detectedAssets.filter((asset) => {
      if (pickerType === "character") {
        if (!otgIsSavedCharacterPickerAssetV36BPJ1(asset)) return false;
      } else if (pickerType && asset.type !== pickerType) {
        return false;
      }
      if (!search) return true;
      return [asset.name, asset.description, asset.workflowImage, asset.source].join(" ").toLowerCase().includes(search);
    });
  }, [assetSearch, detectedAssets, pickerType]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scenes));
    }
  }, [scenes]);

  async function refreshAssetBridge() {
    const localAssets = collectLocalStorageAssetsV36BO5C();
    const fetchedAssets: SceneAsset[] = [];
    const errors: string[] = [];

    const results = await Promise.allSettled(ASSET_BRIDGE_ENDPOINTS_V36BO5C.map((endpoint) => fetchAssetBridgeEndpointV36BO5C(endpoint)));
    results.forEach((result, index) => {
      if (result.status === "fulfilled") fetchedAssets.push(...result.value);
      else errors.push(`${ASSET_BRIDGE_ENDPOINTS_V36BO5C[index].label}: ${safeErrorMessage(result.reason)}`);
    });

    const nextAssets = dedupeAssetsV36BO5C([...fetchedAssets, ...localAssets]);
    setBridgeAssets(nextAssets);
    setAssetBridgeErrors(errors.slice(0, 8));
    setAssetBridgeStatus(
      nextAssets.length
        ? `Loaded ${nextAssets.length} reusable asset reference(s).`
        : "No reusable project assets found automatically. Use manual reference fields or wire the exact asset APIs next.",
    );
  }

  useEffect(() => {
    void refreshAssetBridge();
  }, []);

  function updateSelectedPass(updater: (pass: ScenePass) => ScenePass) {
    setScenes((current) =>
      current.map((scene, sceneIndex) => {
        if (sceneIndex !== selectedSceneIndex) return scene;
        return {
          ...scene,
          passes: scene.passes.map((pass, passIndex) => (passIndex === selectedPassIndex ? updater(pass) : pass)),
        };
      }),
    );
  }

  function updateSelectedScene(updater: (scene: SceneRecord) => SceneRecord) {
    setScenes((current) => current.map((scene, index) => (index === selectedSceneIndex ? updater(scene) : scene)));
  }

  function addReference(asset: SceneAsset) {
    if (!selectedPass || !canAddReference(selectedPass)) return;

    const workflowImage = normalizeImageForWorkflow(otgWorkflowImagePathV36BPA(asset));
    const normalized: SceneAsset = {
      ...asset,
      workflowImage,
      previewUrl: otgCharacterPreviewPathV36BPA(asset) || asset.previewUrl || normalizeImageForPreview(workflowImage),
      description: asset.description || (asset.type === "background" ? "" : `${asset.name}.`),
      locked: Boolean(asset.locked),
    };

    updateSelectedPass((pass) => {
      if (!canAddReference(pass)) return pass;
      if (pass.references.some((ref) => referenceKey(ref) === referenceKey(normalized))) return pass;
      return { ...pass, references: [...pass.references, normalized] };
    });
  }

  function addManualReference() {
    const workflowImage = normalizeImageForWorkflow(manual.workflowImage);
    if (!workflowImage || !manual.name.trim()) return;
    if (manual.type !== "background" && manual.type !== "base" && !manual.description.trim()) return;

    addReference({
      id: uid("manual-ref"),
      type: manual.type,
      name: manual.name.trim(),
      description: manual.description.trim(),
      workflowImage,
      previewUrl: manual.previewUrl.trim() || normalizeImageForPreview(workflowImage),
      source: "manual",
    });

    setManual({
      type: manual.type,
      name: "",
      workflowImage: "",
      previewUrl: "",
      description: "",
    });
  }

  function removeReference(assetId: string) {
    updateSelectedPass((pass) => ({
      ...pass,
      references: pass.references.filter((ref) => ref.locked || ref.id !== assetId),
    }));
  }

  function clearUnlockedReferences() {
    updateSelectedPass((pass) => ({
      ...pass,
      references: pass.references.filter((ref) => ref.locked),
    }));
  }

  function openAssetPicker(type: SceneAsset["type"]) {
    setPickerType(type);
    setAssetSearch("");
  }

  async function submitCurrentPass(kind: "submit" | "redo" = "submit") {
    if (!selectedPass || !selectedScene) return;

    const rawPrompt = selectedPass.prompt.trim();
    const prompt = ensureAddToFirstImagePromptV36BPK1(rawPrompt, selectedPassIndex + 1);
    if (!rawPrompt) {
      updateSelectedPass((pass) => ({ ...pass, status: "error", error: "Prompt is required." }));
      return;
    }

    if (prompt !== rawPrompt) {
      updateSelectedPass((pass) => ({ ...pass, prompt }));
    }

    if (!selectedPass.references.length) {
      updateSelectedPass((pass) => ({ ...pass, status: "error", error: "At least one image reference is required." }));
      return;
    }

    updateSelectedPass((pass) => ({
      ...pass,
      status: "submitting",
      error: "",
      resultImageUrl: kind === "redo" ? "" : pass.resultImageUrl,
      resultWorkflowImage: kind === "redo" ? "" : pass.resultWorkflowImage,
    }));

    try {
      const response = await fetch("/api/production/picture/scene-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneId: selectedScene.id,
          passIndex: selectedPassIndex + 1,
          prompt,
          negativePrompt: selectedPass.negativePrompt,
          waitForResult: true,
          waitMs: 120000,
          references: selectedPass.references.map((ref, index) => ({
            slot: index + 1,
            type: ref.type,
            name: ref.name,
            description: ref.description,
            workflowImage: normalizeImageForWorkflow(ref.workflowImage),
            locked: ref.locked,
          })),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || data.ok === false) throw new Error(asString(data.error) || `Scene pass failed with HTTP ${response.status}.`);

      const outputImageUrl = asString(data.outputImageUrl);
      const outputWorkflowImage = asString(data.outputWorkflowImage);
      const positivePrompt = asString(data.positivePrompt);

      updateSelectedPass((pass) => ({
        ...pass,
        status: "complete",
        error: "",
        sentPrompt: positivePrompt,
        resultImageUrl: outputImageUrl,
        resultWorkflowImage: outputWorkflowImage,
        response: data,
      }));
    } catch (error) {
      updateSelectedPass((pass) => ({
        ...pass,
        status: "error",
        error: safeErrorMessage(error),
      }));
    }
  }

  function passToNextPrompt() {
    if (!selectedScene || !selectedPass || selectedPassIndex >= MAX_PASSES - 1) return;

    const baseReference = makeBaseReferenceFromPass(selectedPass);
    if (!baseReference) {
      updateSelectedPass((pass) => ({
        ...pass,
        status: "error",
        error: "Submit the current pass first. The returned image is required as the locked base for the next pass.",
      }));
      return;
    }

    updateSelectedScene((scene) => {
      const nextIndex = selectedPassIndex + 1;
      const nextPasses = scene.passes.slice();

      if (!nextPasses[nextIndex]) {
        nextPasses[nextIndex] = emptyPass(nextIndex + 1, [baseReference]);
      } else {
        const existingUnlocked = nextPasses[nextIndex].references.filter((ref) => !ref.locked).slice(0, 2);
        nextPasses[nextIndex] = {
          ...nextPasses[nextIndex],
          references: [baseReference, ...existingUnlocked],
        };
      }

      return { ...scene, passes: nextPasses.slice(0, MAX_PASSES) };
    });

    setSelectedPassIndex((index) => Math.min(index + 1, MAX_PASSES - 1));
  }

  function completeScene() {
    if (!selectedPass?.resultImageUrl && !selectedPass?.resultWorkflowImage) {
      updateSelectedPass((pass) => ({
        ...pass,
        status: "error",
        error: "Submit this prompt pass before completing the scene.",
      }));
      return;
    }

    updateSelectedScene((scene) => ({
      ...scene,
      completedImageUrl: selectedPass.resultImageUrl || normalizeImageForPreview(selectedPass.resultWorkflowImage || ""),
      completedWorkflowImage: selectedPass.resultWorkflowImage,
    }));
  }

  function resetSelectedScene() {
    updateSelectedScene((scene) => ({
      id: scene.id,
      name: scene.name,
      inputSceneImage: "",
    passes: [emptyPass(1)],
    }));
    setSelectedPassIndex(0);
  }

  function setSceneInputImage(sceneIndex: number, value: string) {
    const inputSceneImage = value.trim();

    setScenes((current) =>
      current.map((scene, index) => {
        if (index !== sceneIndex) return scene;

        const nextScene: SceneRecord = {
          ...scene,
          inputSceneImage,
        };

        const inputReference = makeInputSceneReferenceV36BPL1(nextScene);
        const passes = scene.passes.length ? scene.passes : [emptyPass(1)];

        return {
          ...nextScene,
          passes: passes.map((pass, passIndex) => {
            if (passIndex !== 0) return pass;

            const referencesWithoutOldInput = pass.references.filter((ref) => ref.source !== "scene-input" && !ref.id.startsWith("input-scene-"));
            return {
              ...pass,
              references: inputReference ? [inputReference, ...referencesWithoutOldInput].slice(0, MAX_REFERENCES) : referencesWithoutOldInput,
            };
          }),
        };
      }),
    );
  }

  async function uploadSceneInputImage(sceneIndex: number, file: File | null) {
    if (!file) return;

    const scene = scenes[sceneIndex];
    if (!scene) return;

    const form = new FormData();
    form.set("image", file);
    form.set("sceneId", scene.id || `scene-${sceneIndex + 1}`);
    form.set("profile", "test_profile");

    try {
      const response = await fetch("/api/production/picture/scene-input-upload", {
        method: "POST",
        body: form,
      });

      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || data.ok === false) {
        throw new Error(asString(data.error) || `Scene input upload failed with HTTP ${response.status}.`);
      }

      const workflowImage = asString(data.workflowImage) || asString(data.imagePath) || asString(data.previewUrl);
      if (!workflowImage) throw new Error("Scene input upload did not return an image path.");

      setSceneInputImage(sceneIndex, workflowImage);
    } catch (error) {
      const message = safeErrorMessage(error);
      setAssetBridgeErrors((current) => [`Scene ${sceneIndex + 1} input upload: ${message}`, ...current].slice(0, 8));
      setAssetBridgeStatus(`Scene ${sceneIndex + 1} input upload failed: ${message}`);
    }
  }


  const referenceCount = selectedPass?.references.length || 0;
  const availableSlots = Math.max(0, MAX_REFERENCES - referenceCount);
  const addDisabled = !selectedPass || availableSlots <= 0 || selectedPass.status === "submitting";

  return (
    <div data-otg-qwen-component-mobile-layout="OTG_QWEN_SOURCE_MOBILE_RELEASE_PATCH_V1" style={{ display: "grid", gap: 16, color: "#f4f4f5", width: "100%", maxWidth: "100%", minWidth: 0, overflowX: "hidden" }}>
      <section style={{ border: "1px solid #30323a", borderRadius: 14, padding: 14, background: "#111318" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 1.2, color: "#a1a1aa", textTransform: "uppercase" }}>Qwen Scene Builder</div>
            <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>Minimal prompt-pass storyboard</h2>
            <p style={{ margin: "6px 0 0", color: "#a1a1aa", maxWidth: 780 }}>
              One scene image at a time. Background counts as one image. Each pass supports 3 total images. After Pass 1, the previous result becomes a locked base and only 2 more images can be added.
            </p>
          </div>
          <button
            type="button"
            onClick={resetSelectedScene}
            style={{ border: "1px solid #52525b", borderRadius: 10, padding: "8px 11px", background: "transparent", color: "#f4f4f5", cursor: "pointer" }}
          >
            Reset selected scene
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, marginTop: 14 }}>
          {scenes.map((scene, index) => (
            <div key={`${scene.id}-input`} style={{ display: "grid", gap: 4, fontSize: 10, color: "#a1a1aa" }}>
              <span style={{ textTransform: "uppercase", letterSpacing: 0.8 }}>Input scene</span>
              <input
                value={scene.inputSceneImage || ""}
                onChange={(event) => setSceneInputImage(index, event.target.value)}
                placeholder="image filename/path/url"
                style={{
                  width: "100%",
                  border: "1px solid #30323a",
                  borderRadius: 8,
                  padding: "6px 7px",
                  background: "#090b10",
                  color: "#f4f4f5",
                  fontSize: 11,
                }}
              />
              <label
                style={{
                  border: "1px solid #52525b",
                  borderRadius: 8,
                  padding: "6px 7px",
                  background: "#181a20",
                  color: "#f4f4f5",
                  fontSize: 11,
                  textAlign: "center",
                  cursor: "pointer",
                }}
              >
                Upload image
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] || null;
                    event.currentTarget.value = "";
                    void uploadSceneInputImage(index, file);
                  }}
                  style={{ display: "none" }}
                />
              </label>
              {scene.inputSceneImage ? (
                <button type="button" onClick={() => setSceneInputImage(index, "")} style={{ ...smallButtonStyle, padding: "5px 7px", fontSize: 11 }}>
                  Clear
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, marginTop: 14 }}>
          {scenes.map((scene, index) => (
            <button
              key={scene.id}
              type="button"
              onClick={() => {
                setSelectedSceneIndex(index);
                setSelectedPassIndex(0);
              }}
              style={{
                border: index === selectedSceneIndex ? "1px solid #93c5fd" : "1px solid #30323a",
                borderRadius: 12,
                padding: 8,
                minHeight: 72,
                background: index === selectedSceneIndex ? "#172033" : "#181a20",
                color: "#f4f4f5",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ fontSize: 12, color: "#a1a1aa" }}>{scene.name}</div>
              {scene.completedImageUrl ? (
                <img src={otgComfySafeImageSrcV36BPI2(otgSceneResultImageUrlV36BPH1(otgAssetDisplayUrlV36BPA(otgDisplayImageUrlV36BP8(otgDisplayImageUrlV36BP6(scene.completedImageUrl)))))} alt={scene.name} style={{ background: "#050505",  width: "100%", height: 42, objectFit: "contain", borderRadius: 8, marginTop: 6 }} />
              ) : (
                <div style={{ marginTop: 8, fontSize: 11, color: "#71717a" }}>empty</div>
              )}
            </button>
          ))}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: "100%", minWidth: 0, overflowX: "hidden" }}>
        <aside style={{ border: "1px solid #30323a", borderRadius: 14, padding: 12, background: "#111318", height: "fit-content", width: "100%", maxWidth: "100%", minWidth: 0, overflowX: "hidden" }}>
          <div style={{ fontSize: 12, letterSpacing: 1, color: "#a1a1aa", textTransform: "uppercase", marginBottom: 8 }}>Prompt Passes</div>
          {(selectedScene?.passes || []).map((pass, index) => (
            <button
              key={pass.id}
              type="button"
              onClick={() => setSelectedPassIndex(index)}
              style={{
                display: "block",
                width: "100%",
                border: index === selectedPassIndex ? "1px solid #93c5fd" : "1px solid #30323a",
                borderRadius: 10,
                padding: 10,
                marginBottom: 8,
                background: index === selectedPassIndex ? "#172033" : "#181a20",
                color: "#f4f4f5",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>Prompt {index + 1}</span>
                <span style={{ color: "#a1a1aa" }}>{pass.references.length}/3</span>
              </div>
              <div style={{ fontSize: 11, color: pass.status === "error" ? "#fca5a5" : "#a1a1aa", marginTop: 4 }}>{pass.status}</div>
            </button>
          ))}
        </aside>

        <main style={{ display: "grid", gap: 14, width: "100%", maxWidth: "100%", minWidth: 0, overflowX: "hidden" }}>
          {selectedPass ? (
            <section style={{ border: "1px solid #30323a", borderRadius: 14, padding: 14, background: "#111318" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: 1 }}>Scene Prompt {selectedPassIndex + 1}</div>
                  <div style={{ color: "#a1a1aa", fontSize: 12 }}>Images selected: {referenceCount}/3. Available: {availableSlots}.</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" title="Mic placeholder" style={smallButtonStyle}>Mic</button>
                  <button type="button" onClick={() => submitCurrentPass("submit")} disabled={selectedPass.status === "submitting"} style={smallButtonStyle}>
                    {selectedPass.status === "submitting" ? "Submitting..." : "Submit Prompt"}
                  </button>
                  <button type="button" onClick={() => submitCurrentPass("redo")} disabled={selectedPass.status === "submitting"} style={smallButtonStyle}>
                    Redo Prompt
                  </button>
                  <button type="button" onClick={passToNextPrompt} disabled={selectedPass.status === "submitting" || selectedPassIndex >= MAX_PASSES - 1} style={smallButtonStyle}>
                    Pass to Prompt {Math.min(selectedPassIndex + 2, MAX_PASSES)}
                  </button>
                  <button type="button" onClick={completeScene} disabled={selectedPass.status === "submitting"} style={smallButtonStyle}>
                    Complete Scene
                  </button>
                </div>
              </div>

              <textarea
                value={selectedPass.prompt}
                onChange={(event) => updateSelectedPass((pass) => ({ ...pass, prompt: event.target.value }))}
                placeholder="Describe only this prompt pass. Example: The dark angel and robot hover above the mansion in a storm-lit sky."
                rows={5}
                style={{
                  width: "100%",
                  marginTop: 12,
                  border: "1px solid #30323a",
                  borderRadius: 12,
                  background: "#090a0e",
                  color: "#f4f4f5",
                  padding: 12,
                  resize: "vertical",
                }}
              />

              <details style={{ marginTop: 10 }}>
                <summary style={{ color: "#a1a1aa", cursor: "pointer" }}>Negative prompt</summary>
                <textarea
                  value={selectedPass.negativePrompt}
                  onChange={(event) => updateSelectedPass((pass) => ({ ...pass, negativePrompt: event.target.value }))}
                  rows={2}
                  style={{
                    width: "100%",
                    marginTop: 8,
                    border: "1px solid #30323a",
                    borderRadius: 10,
                    background: "#090a0e",
                    color: "#f4f4f5",
                    padding: 10,
                  }}
                />
              </details>

              {selectedPass.error ? (
                <div style={{ marginTop: 10, border: "1px solid #7f1d1d", borderRadius: 10, padding: 10, background: "#2a1111", color: "#fecaca" }}>{selectedPass.error}</div>
              ) : null}

              {selectedPass.sentPrompt ? (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ color: "#a1a1aa", cursor: "pointer" }}>Prompt sent to workflow</summary>
                  <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", padding: 10, borderRadius: 10, background: "#090a0e", color: "#d4d4d8" }}>{selectedPass.sentPrompt}</pre>
                </details>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, marginTop: 12 }}>
                {selectedPass.references.map((ref, index) => (
                  <div key={`${ref.id}-${index}`} style={{ border: ref.locked ? "1px solid #fbbf24" : "1px solid #30323a", borderRadius: 12, padding: 8, background: "#181a20" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <strong style={{ fontSize: 12 }}>{ref.locked ? "Locked base" : ref.type}</strong>
                      {!ref.locked ? (
                        <button type="button" onClick={() => removeReference(ref.id)} style={{ ...smallButtonStyle, padding: "4px 7px" }}>
                          Remove
                        </button>
                      ) : null}
                    </div>
                    {ref.previewUrl || ref.workflowImage ? (
                      <img src={otgComfySafeImageSrcV36BPI2(otgAssetDisplayUrlV36BPA(otgCharacterPreviewPathV36BPA(ref)))} alt={ref.name} style={{ width: "100%", height: 190, objectFit: "contain", borderRadius: 8, marginTop: 8, background: "#050505", padding: "6px" }} />
                    ) : null}
                    <div style={{ marginTop: 7, fontSize: 12, color: "#f4f4f5" }}>{ref.name}</div>
                    <div style={{ marginTop: 3, fontSize: 11, color: "#a1a1aa", wordBreak: "break-all" }}>{ref.workflowImage}</div>
                  </div>
                ))}
              </div>

              {selectedPass.resultImageUrl ? (
                <div style={{ marginTop: 14, border: "1px solid #365314", borderRadius: 14, padding: 10, background: "#10180d" }}>
                  <div style={{ fontSize: 12, color: "#bef264", marginBottom: 8 }}>Prompt {selectedPassIndex + 1} preview</div>
                  <img src={otgComfySafeImageSrcV36BPI2(otgSceneResultImageUrlV36BPH1(otgAssetDisplayUrlV36BPA(otgDisplayImageUrlV36BP8(otgDisplayImageUrlV36BP6(selectedPass.resultImageUrl)))))} alt={`Prompt ${selectedPassIndex + 1} result`} style={{ width: "100%", maxHeight: 520, objectFit: "contain", borderRadius: 10, background: "#050505" }} />
                </div>
              ) : null}
            </section>
          ) : null}

          <section style={{ border: "1px solid #30323a", borderRadius: 14, padding: 14, background: "#111318" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: 1 }}>Add image reference</div>
                <div style={{ color: "#a1a1aa", fontSize: 12 }}>Background, character, object, and locked base all count as images. Limit is always 3.</div>
              </div>
              <div style={{ color: availableSlots <= 0 ? "#fca5a5" : "#a1a1aa", fontSize: 13 }}>{referenceCount}/3 selected</div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button type="button" onClick={() => openAssetPicker("character")} disabled={addDisabled} style={smallButtonStyle}>Character Gallery</button>
              <button type="button" onClick={() => openAssetPicker("background")} disabled={addDisabled} style={smallButtonStyle}>Background Gallery</button>
              <button type="button" onClick={() => openAssetPicker("object")} disabled={addDisabled} style={smallButtonStyle}>Object / Prop Gallery</button>
              <button type="button" onClick={clearUnlockedReferences} disabled={!selectedPass || selectedPass.status === "submitting"} style={smallButtonStyle}>Clear Unlocked References</button>
              <button type="button" onClick={() => void refreshAssetBridge()} style={smallButtonStyle}>Refresh Asset Bridge</button>
            </div>

            <div style={{ marginTop: 8, color: "#a1a1aa", fontSize: 12 }}>{assetBridgeStatus}</div>
            {assetBridgeErrors.length ? (
              <details style={{ marginTop: 6 }}>
                <summary style={{ color: "#a1a1aa", cursor: "pointer", fontSize: 12 }}>Asset bridge skipped APIs</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "#a1a1aa" }}>{assetBridgeErrors.join("\n")}</pre>
              </details>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, marginTop: 10 }}>
              <select value={manual.type} onChange={(event) => setManual((current) => ({ ...current, type: event.target.value as ManualReferenceForm["type"] }))} disabled={addDisabled} style={inputStyle}>
                <option value="character">Character</option>
                <option value="background">Background</option>
                <option value="object">Object</option>
              </select>
              <input value={manual.name} onChange={(event) => setManual((current) => ({ ...current, name: event.target.value }))} placeholder="Name" disabled={addDisabled} style={inputStyle} />
              <input value={manual.workflowImage} onChange={(event) => setManual((current) => ({ ...current, workflowImage: event.target.value }))} placeholder="Workflow image filename or /view URL" disabled={addDisabled} style={inputStyle} />
            </div>
            <textarea
              value={manual.description}
              onChange={(event) => setManual((current) => ({ ...current, description: event.target.value }))}
              placeholder="Description required for characters/objects. Background description is optional."
              rows={2}
              disabled={addDisabled}
              style={{ ...inputStyle, width: "100%", marginTop: 8, resize: "vertical" }}
            />
            <button type="button" onClick={addManualReference} disabled={addDisabled} style={{ ...smallButtonStyle, marginTop: 8 }}>
              Add Reference
            </button>

            {pickerType ? (
              <div style={{ marginTop: 14, border: "1px solid #30323a", borderRadius: 12, padding: 10, background: "#0d0f14" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: 1 }}>{pickerType} picker</div>
                    <div style={{ color: "#a1a1aa", fontSize: 12 }}>{filteredDetectedAssets.length} matching asset(s). Add is disabled only at 3/3 or while submitting.</div>
                  </div>
                  <button type="button" onClick={() => setPickerType(null)} style={smallButtonStyle}>Close Picker</button>
                </div>
                <input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search assets" style={{ ...inputStyle, width: "100%", marginTop: 10 }} />
                {filteredDetectedAssets.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, marginTop: 10 }}>
                    {filteredDetectedAssets.slice(0, 100).map((asset) => (
                      <div key={`${asset.id}-${asset.workflowImage}`} style={{ border: "1px solid #30323a", borderRadius: 12, padding: 8, background: "#181a20" }}>
                        {asset.previewUrl ? <img src={otgComfySafeImageSrcV36BPI2(otgAssetDisplayUrlV36BPA(otgCharacterPreviewPathV36BPA(asset)))} alt={asset.name} style={{ width: "100%", height: 190, objectFit: "contain", borderRadius: 8, background: "#050505", padding: "6px" }} /> : null}
                        <div style={{ marginTop: 7, fontSize: 12, color: "#f4f4f5" }}>{asset.name}</div>
                        <div style={{ fontSize: 11, color: "#a1a1aa" }}>{asset.type} · {asset.source}</div>
                        <div style={{ marginTop: 4, fontSize: 10, color: "#71717a", wordBreak: "break-all" }}>{asset.workflowImage}</div>
                        <button type="button" onClick={() => addReference(asset)} disabled={addDisabled} style={{ ...smallButtonStyle, marginTop: 8, width: "100%" }}>
                          Add {asset.type}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ marginTop: 12, color: "#a1a1aa", fontSize: 13 }}>
                    No {pickerType} assets were found automatically. Use manual reference fields above for now.
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </main>
      </section>
    </div>
  );
}

const smallButtonStyle: React.CSSProperties = {
  border: "1px solid #3f3f46",
  borderRadius: 10,
  padding: "7px 10px",
  background: "#181a20",
  color: "#f4f4f5",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #30323a",
  borderRadius: 10,
  background: "#090a0e",
  color: "#f4f4f5",
  padding: "8px 10px",
};
