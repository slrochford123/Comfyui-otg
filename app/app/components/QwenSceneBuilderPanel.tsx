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

  if (/^\/(home|opt|var|mnt|srv|tmp)\//i.test(raw)) {
    return `/api/file?path=${encodeURIComponent(raw)}`;
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

function createSceneRecord(index: number): SceneRecord {
  return {
    id: `scene-${index + 1}`,
    name: `Scene ${index + 1}`,
    inputSceneImage: "",
    passes: [emptyPass(1)],
  };
}

function createInitialScenes(): SceneRecord[] {
  return [createSceneRecord(0)];
}

function sceneHasMeaningfulContent(scene: SceneRecord) {
  return Boolean(
    String(scene.inputSceneImage || "").trim() ||
      String(scene.completedImageUrl || "").trim() ||
      String(scene.completedWorkflowImage || "").trim() ||
      scene.passes.some((pass) =>
        Boolean(
          String(pass.prompt || "").trim() ||
            pass.references.length ||
            String(pass.resultImageUrl || "").trim() ||
            String(pass.resultWorkflowImage || "").trim(),
        ),
      ),
  );
}

// OTG_QWEN_DYNAMIC_SCENE_STACK_V1
// OTG_QWEN_STORYBOARD_REFERENCE_UX_V1

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

// OTG_QWEN_SCENE_BACKGROUND_EQUIP_V1_START
function qwenReferenceRankV1(ref: SceneAsset) {
  if (ref.locked || ref.type === "base") return 0;
  if (ref.type === "character") return 1;
  if (ref.type === "background") return 2;
  if (ref.type === "object") return 3;
  return 4;
}

function qwenOrderedReferencesV1(references: SceneAsset[]) {
  return references
    .map((ref, index) => ({ ref, index }))
    .sort((a, b) => qwenReferenceRankV1(a.ref) - qwenReferenceRankV1(b.ref) || a.index - b.index)
    .map(({ ref }) => ref)
    .slice(0, MAX_REFERENCES);
}
// OTG_QWEN_SCENE_BACKGROUND_EQUIP_V1_END

function getReferenceLimit(pass: ScenePass) {
  const lockedCount = pass.references.filter((ref) => ref.locked).length;
  return lockedCount ? MAX_REFERENCES : MAX_REFERENCES;
}

// OTG_QWEN_BACKGROUND_SELECTION_V2_START
function qwenEquipReferenceV2(pass: ScenePass, normalized: SceneAsset) {
  const limit = getReferenceLimit(pass);
  const sameReferenceIndex = pass.references.findIndex((ref) => referenceKey(ref) === referenceKey(normalized));

  if (sameReferenceIndex >= 0) {
    const refreshed = pass.references.map((ref, index) =>
      index === sameReferenceIndex ? { ...ref, ...normalized, locked: Boolean(ref.locked || normalized.locked) } : ref,
    );
    return { references: qwenOrderedReferencesV1(refreshed), equipped: true, reason: "already-equipped" };
  }

  let nextReferences = [...pass.references];

  if (normalized.type === "background") {
    nextReferences = nextReferences.filter((ref) => ref.locked || ref.type !== "background");

    while (nextReferences.length >= limit) {
      let removableIndex = -1;

      for (let index = nextReferences.length - 1; index >= 0; index -= 1) {
        const ref = nextReferences[index];
        if (!ref.locked && ref.type === "object") {
          removableIndex = index;
          break;
        }
      }

      if (removableIndex < 0) {
        const unlockedCharacterIndexes = nextReferences
          .map((ref, index) => ({ ref, index }))
          .filter(({ ref }) => !ref.locked && ref.type === "character")
          .map(({ index }) => index);
        if (unlockedCharacterIndexes.length > 1) removableIndex = unlockedCharacterIndexes[unlockedCharacterIndexes.length - 1] ?? -1;
      }

      if (removableIndex < 0) {
        for (let index = nextReferences.length - 1; index >= 0; index -= 1) {
          const ref = nextReferences[index];
          if (!ref.locked && ref.type !== "background") {
            removableIndex = index;
            break;
          }
        }
      }

      if (removableIndex < 0) {
        return {
          references: pass.references,
          equipped: false,
          reason: "All three reference slots are locked. Remove or advance the locked pass before equipping a background.",
        };
      }

      nextReferences.splice(removableIndex, 1);
    }
  } else if (nextReferences.length >= limit) {
    return {
      references: pass.references,
      equipped: false,
      reason: "The three-image reference limit has been reached.",
    };
  }

  return {
    references: qwenOrderedReferencesV1([...nextReferences, normalized]),
    equipped: true,
    reason: "equipped",
  };
}
// OTG_QWEN_BACKGROUND_SELECTION_V2_END

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


// OTG_QWEN_OWNER_SCOPED_REFERENCE_GALLERIES_V1
function qwenAssetBridgeSafeOwnerV1(value: unknown): string {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
    .slice(0, 80);

  if (!cleaned || cleaned.length < 3) return "";
  if ([
    "web_characters_builder",
    "profile_unresolved",
    "undefined",
    "null",
    "guest",
    "anonymous",
    "dark",
    "classicui",
    "settings",
    "production",
    "storyboard",
    "animate",
    "visualedit",
    "audiostudio",
    "assemble",
    "generate",
    "angles",
    "gallery",
    "voices",
    "characters",
  ].includes(cleaned)) return "";
  return cleaned;
}

function qwenAssetBridgeOwnerCandidateV1(value: unknown): string {
  if (!value) return "";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return qwenAssetBridgeOwnerCandidateV1(JSON.parse(trimmed));
      } catch {
        return qwenAssetBridgeSafeOwnerV1(trimmed);
      }
    }
    return qwenAssetBridgeSafeOwnerV1(trimmed);
  }

  if (!isRecord(value)) return "";

  const directKeys = ["ownerKey", "ownerId", "deviceId", "userId", "username", "userName", "profileId", "profileName", "profile", "name", "id"];
  for (const key of directKeys) {
    const candidate = qwenAssetBridgeOwnerCandidateV1(value[key]);
    if (candidate) return candidate;
  }

  const nestedKeys = ["user", "account", "session", "currentUser", "activeUser", "activeProfile", "currentProfile"];
  for (const key of nestedKeys) {
    const candidate = qwenAssetBridgeOwnerCandidateV1(value[key]);
    if (candidate) return candidate;
  }

  return "";
}

function qwenActiveOwnerKeyV1(): string {
  if (typeof window === "undefined") return "";

  const preferredKeys = [
    "otg:test-last-user:v1",
    "otg:last-user:v1",
    "otg:current-user:v1",
    "otg:active-user:v1",
    "otg:profile:v1",
    "otg:active-profile:v1",
    "otg:appState_v1",
    "otg:test:page-state:v1",
    "otg_user",
    "otg_profile",
    "user",
    "profile",
  ];

  const storageAreas: Storage[] = [window.localStorage, window.sessionStorage];

  for (const storage of storageAreas) {
    for (const key of preferredKeys) {
      try {
        const candidate = qwenAssetBridgeOwnerCandidateV1(storage.getItem(key));
        if (candidate) return candidate;
      } catch {
        // Ignore malformed browser state.
      }
    }

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index) || "";
      if (!/user|profile|owner|session|auth|account|device/i.test(key)) continue;
      try {
        const candidate = qwenAssetBridgeOwnerCandidateV1(storage.getItem(key));
        if (candidate) return candidate;
      } catch {
        // Ignore malformed browser state.
      }
    }
  }

  const profileNodes = Array.from(document.querySelectorAll("header button, [data-user], [data-profile]"));
  const candidates: string[] = [];
  for (const node of profileNodes) {
    const raw = String(
      node.getAttribute("data-user") ||
        node.getAttribute("data-profile") ||
        node.getAttribute("aria-label") ||
        node.textContent ||
        "",
    ).trim();
    const candidate = qwenAssetBridgeSafeOwnerV1(raw.replace(/^profile\s*[:=-]\s*/i, ""));
    if (candidate) candidates.push(candidate);
  }

  return candidates.length ? candidates[candidates.length - 1] : "";
}

function qwenAssetBridgeRequestV1(endpointUrl: string) {
  const ownerKey = qwenActiveOwnerKeyV1();
  const target = new URL(endpointUrl, window.location.origin);

  if (ownerKey && !target.searchParams.has("deviceId")) {
    target.searchParams.set("deviceId", ownerKey);
  }

  return {
    url: `${target.pathname}${target.search}`,
    ownerKey,
    init: {
      cache: "no-store" as const,
      credentials: ownerKey ? "omit" as const : "same-origin" as const,
      headers: ownerKey ? { "x-otg-device-id": ownerKey } : undefined,
    },
  };
}

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
  const request = qwenAssetBridgeRequestV1(endpoint.url);
  const response = await fetch(request.url, request.init);
  if (!response.ok) throw new Error(`${endpoint.label}: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error(`${endpoint.label}: non-JSON response`);
  const data = (await response.json()) as unknown;
  return collectAssetBridgeAssetsFromUnknownV36BO5C(data, endpoint.label, endpoint.fallbackType, 160);
}


// OTG_QWEN_PROFILE_SAFE_CHARACTER_AND_PROP_GALLERIES_V3
function qwenArrayBucketsV2(data: any): any[] {
  const buckets = [
    Array.isArray(data) ? data : null,
    data?.items,
    data?.characters,
    data?.files,
    data?.images,
    data?.results,
    data?.data,
  ].filter(Array.isArray) as any[][];

  return buckets.flat();
}

function qwenSavedCharacterAssetsV2(data: any): SceneAsset[] {
  const seen = new Set<string>();
  const assets: SceneAsset[] = [];

  qwenArrayBucketsV2(data).forEach((entry: any, index: number) => {
    const previewImage = String(
      entry?.defaultCharacterPreviewImagePath ||
        entry?.defaultCharacterImagePath ||
        entry?.backgroundRemovedDefaultImagePath ||
        entry?.previewImagePath ||
        entry?.fullBodyImagePath ||
        entry?.imagePath ||
        entry?.characterCardPreviewImagePath ||
        "",
    ).trim();
    const workflowImage = String(
      entry?.characterCardWorkflowImagePath ||
        entry?.characterCardPath ||
        entry?.workflowImagePath ||
        entry?.workflowImage ||
        entry?.defaultCharacterImagePath ||
        entry?.backgroundRemovedDefaultImagePath ||
        entry?.imagePath ||
        "",
    ).trim();
    const name = String(entry?.name || entry?.title || entry?.label || `Character ${index + 1}`).trim();
    const id = String(entry?.id || workflowImage || previewImage || name || index).trim();
    const description = String(
      entry?.globalPromptIdentityBlock ||
        entry?.metadata?.promptReadyDescription ||
        entry?.description ||
        `${name}.`,
    ).trim();

    if (!id || !workflowImage || !previewImage) return;
    const key = workflowImage.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    assets.push({
      id,
      type: "character",
      name,
      description,
      workflowImage,
      previewUrl: previewImage,
      source: "saved-character-library",
    });
  });

  return assets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

function qwenRegularGalleryAssetsV2(data: any): SceneAsset[] {
  const seen = new Set<string>();
  const assets: SceneAsset[] = [];

  qwenArrayBucketsV2(data).forEach((entry: any, index: number) => {
    const kind = String(entry?.kind || entry?.type || "").trim().toLowerCase();
    const isVideo = entry?.video === true || kind === "video";
    if (isVideo) return;

    const name = String(
      entry?.name || entry?.fileName || entry?.filename || entry?.sourceName || `Gallery image ${index + 1}`,
    ).trim();
    const directUrl = String(
      entry?.url || entry?.fileUrl || entry?.imageUrl || entry?.previewUrl || entry?.src || "",
    ).trim();
    const serverPath = String(entry?.serverPath || entry?.path || entry?.filePath || "").trim();
    const galleryUrl = directUrl ||
      (serverPath ? `/api/file?path=${encodeURIComponent(serverPath)}` : "") ||
      (name ? `/api/gallery/file?name=${encodeURIComponent(name)}` : "");

    if (!galleryUrl) return;
    const key = galleryUrl.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    assets.push({
      id: String(entry?.id || entry?.key || name || index),
      type: "object",
      name,
      description: `Reusable prop or object reference selected from the regular Gallery: ${name}.`,
      workflowImage: galleryUrl,
      previewUrl: galleryUrl,
      source: "regular-gallery",
    });
  });

  return assets;
}


// OTG_QWEN_BACKGROUND_GALLERY_CANONICAL_PREVIEW_V36BPH2
function qwenBackgroundPreviewLocatorV3(entry: any): string {
  return String(
    entry?.establishingImage?.displayImage ||
      entry?.establishingImage?.imageUrl ||
      entry?.establishingImage?.imagePath ||
      entry?.displayImage ||
      entry?.imageUrl ||
      entry?.imagePath ||
      entry?.panoramaImage?.displayImage ||
      entry?.panoramaImage?.imageUrl ||
      entry?.panoramaImage?.imagePath ||
      entry?.workflowImage ||
      "",
  ).trim();
}

function qwenBackgroundWorkflowLocatorV3(entry: any): string {
  return String(
    entry?.panoramaImage?.workflowImage ||
      entry?.panoramaImage?.imagePath ||
      entry?.workflowImage ||
      entry?.imagePath ||
      entry?.establishingImage?.workflowImage ||
      entry?.establishingImage?.imagePath ||
      entry?.displayImage ||
      entry?.imageUrl ||
      "",
  ).trim();
}

function qwenCanonicalPreviewUrlV3(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(data:image\/|blob:|https?:\/\/)/i.test(raw)) return raw;
  if (raw.startsWith("/api/")) return raw;
  if (/^\/(home|opt|var|mnt|srv|tmp)\//i.test(raw)) {
    return `/api/file?path=${encodeURIComponent(raw)}`;
  }
  if (/^\/[A-Za-z]:[\\/]/.test(raw)) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw.slice(1))}`;
  }
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\")) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw)}`;
  }
  if (raw.startsWith("/")) return raw;
  return normalizeImageForPreview(raw);
}

function qwenSavedBackgroundAssetsV3(data: any): SceneAsset[] {
  const seen = new Set<string>();
  const assets: SceneAsset[] = [];

  qwenArrayBucketsV2(data).forEach((entry: any, index: number) => {
    const displayLocator = qwenBackgroundPreviewLocatorV3(entry);
    const workflowImage = qwenBackgroundWorkflowLocatorV3(entry);
    if (!displayLocator || !workflowImage) return;

    const id = String(entry?.id || workflowImage || displayLocator || index).trim();
    const name = String(entry?.name || entry?.title || `Background ${index + 1}`).trim();
    const key = `${id}:${workflowImage}`.toLowerCase();
    if (!id || seen.has(key)) return;
    seen.add(key);

    assets.push({
      id,
      type: "background",
      name,
      description: String(entry?.continuityBlock || entry?.masterPrompt || entry?.prompt || "").trim(),
      workflowImage,
      previewUrl: qwenCanonicalPreviewUrlV3(displayLocator),
      source: "saved-background-library",
    });
  });

  return assets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

async function qwenLoadCharacterGalleryV2() {
  const ownerKey = qwenActiveOwnerKeyV1();
  const attempts: Array<{ url: string; init: RequestInit; label: string }> = [
    {
      url: "/api/characters",
      label: "signed-in profile",
      init: { cache: "no-store", credentials: "include" },
    },
  ];

  if (ownerKey) {
    const url = new URL("/api/characters", window.location.origin);
    url.searchParams.set("deviceId", ownerKey);
    attempts.push({
      url: `${url.pathname}${url.search}`,
      label: ownerKey,
      init: {
        cache: "no-store",
        credentials: "omit",
        headers: { "x-otg-device-id": ownerKey },
      },
    });
  }

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, attempt.init);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        errors.push(`${attempt.label}: HTTP ${response.status}${data?.error ? ` - ${data.error}` : ""}`);
        continue;
      }
      const assets = qwenSavedCharacterAssetsV2(data);
      if (assets.length) return { assets, ownerKey, errors };
    } catch (error) {
      errors.push(`${attempt.label}: ${safeErrorMessage(error)}`);
    }
  }

  return { assets: [] as SceneAsset[], ownerKey, errors };
}

async function qwenLoadBackgroundGalleryV3() {
  const ownerKey = qwenActiveOwnerKeyV1();
  const attempts: Array<{ url: string; init: RequestInit; label: string }> = [
    {
      url: "/api/backgrounds",
      label: "signed-in profile",
      init: { cache: "no-store", credentials: "include" },
    },
  ];

  if (ownerKey) {
    const url = new URL("/api/backgrounds", window.location.origin);
    url.searchParams.set("deviceId", ownerKey);
    attempts.push({
      url: `${url.pathname}${url.search}`,
      label: ownerKey,
      init: {
        cache: "no-store",
        credentials: "omit",
        headers: { "x-otg-device-id": ownerKey },
      },
    });
  }

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, attempt.init);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        errors.push(`${attempt.label}: HTTP ${response.status}${data?.error ? ` - ${data.error}` : ""}`);
        continue;
      }
      const assets = qwenSavedBackgroundAssetsV3(data);
      if (assets.length) return { assets, ownerKey, errors };
    } catch (error) {
      errors.push(`${attempt.label}: ${safeErrorMessage(error)}`);
    }
  }

  return { assets: [] as SceneAsset[], ownerKey, errors };
}

async function qwenLoadRegularGalleryV2() {
  const candidateUrls = [
    "/api/gallery?media=image&sort=newest&per=5000",
    "/api/gallery?filter=images&sort=newest&per=5000",
    "/api/gallery?sort=newest&per=5000",
  ];
  const errors: string[] = [];

  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "include",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        errors.push(`${url}: HTTP ${response.status}${data?.error ? ` - ${data.error}` : ""}`);
        continue;
      }
      const assets = qwenRegularGalleryAssetsV2(data);
      if (assets.length) return { assets, errors };
    } catch (error) {
      errors.push(`${url}: ${safeErrorMessage(error)}`);
    }
  }

  return { assets: [] as SceneAsset[], errors };
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

    const normalized = (parsed.filter(isRecord).slice(0, MAX_SCENES) as unknown as SceneRecord[]).map((scene, index) => ({
      id: scene.id || `scene-${index + 1}`,
      name: scene.name || `Scene ${index + 1}`,
      completedImageUrl: scene.completedImageUrl,
      completedWorkflowImage: scene.completedWorkflowImage,
      inputSceneImage: scene.inputSceneImage || "",
      passes: Array.isArray(scene.passes) && scene.passes.length ? scene.passes.slice(0, MAX_PASSES) : [emptyPass(1)],
    }));

    if (!normalized.length) return createInitialScenes();

    while (normalized.length > 1 && !sceneHasMeaningfulContent(normalized[normalized.length - 1])) {
      normalized.pop();
    }

    return normalized;
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
  const [pickerAssets, setPickerAssets] = useState<SceneAsset[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [pickerPreviewAsset, setPickerPreviewAsset] = useState<SceneAsset | null>(null);
  const [brokenPickerPreviewKeys, setBrokenPickerPreviewKeys] = useState<Record<string, true>>({});
  const [backgroundEquipNotice, setBackgroundEquipNotice] = useState("");
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
    const sourceAssets = pickerType ? pickerAssets : detectedAssets;
    return sourceAssets.filter((asset) => {
      if (pickerType === "character") {
        if (asset.type !== "character") return false;
      } else if (pickerType && asset.type !== pickerType) {
        return false;
      }
      if (!search) return true;
      return [asset.name, asset.description, asset.workflowImage, asset.source].join(" ").toLowerCase().includes(search);
    });
  }, [assetSearch, detectedAssets, pickerAssets, pickerType]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scenes));
    }
  }, [scenes]);

  useEffect(() => {
    setBackgroundEquipNotice("");
  }, [selectedSceneIndex, selectedPassIndex]);

  useEffect(() => {
    if (!pickerPreviewAsset || typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerPreviewAsset(null);
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [pickerPreviewAsset]);

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
    if (!selectedPass) return;

    const workflowImage = normalizeImageForWorkflow(otgWorkflowImagePathV36BPA(asset));
    if (!workflowImage) {
      setPickerError(`${asset.name} has no usable workflow image and cannot be equipped.`);
      return;
    }

    const normalized: SceneAsset = {
      ...asset,
      workflowImage,
      previewUrl: otgCharacterPreviewPathV36BPA(asset) || asset.previewUrl || normalizeImageForPreview(workflowImage),
      description: asset.description || (asset.type === "background" ? "" : `${asset.name}.`),
      locked: Boolean(asset.locked),
    };

    const previewResult = qwenEquipReferenceV2(selectedPass, normalized);
    if (!previewResult.equipped) {
      setPickerError(previewResult.reason);
      if (normalized.type === "background") setBackgroundEquipNotice("");
      return;
    }

    updateSelectedPass((pass) => {
      const result = qwenEquipReferenceV2(pass, normalized);
      if (!result.equipped) return { ...pass, status: "error", error: result.reason };
      return {
        ...pass,
        error: pass.status === "error" ? "" : pass.error,
        status: pass.status === "error" ? "idle" : pass.status,
        references: result.references,
      };
    });

    setPickerError("");
    if (normalized.type === "background") {
      setBackgroundEquipNotice(`Background equipped: ${normalized.name}. It is attached to Prompt ${selectedPassIndex + 1} and will be submitted with the character image.`);
    }
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
    const removingBackground = Boolean(selectedPass?.references.some((ref) => ref.id === assetId && ref.type === "background"));
    updateSelectedPass((pass) => ({
      ...pass,
      references: pass.references.filter((ref) => ref.locked || ref.id !== assetId),
    }));
    if (removingBackground) setBackgroundEquipNotice("");
  }

  function clearUnlockedReferences() {
    updateSelectedPass((pass) => ({
      ...pass,
      references: pass.references.filter((ref) => ref.locked),
    }));
    setBackgroundEquipNotice("");
  }

  async function loadPickerAssetsV2(type: SceneAsset["type"]) {
    setPickerLoading(true);
    setPickerError("");

    try {
      if (type === "character") {
        const result = await qwenLoadCharacterGalleryV2();
        setPickerAssets(result.assets);
        if (!result.assets.length) {
          setPickerError(
            result.ownerKey
              ? `No saved characters with usable images were found for ${result.ownerKey}.`
              : "You are browsing as Guest. Sign in to the same profile that owns the saved characters, then reopen Character Gallery.",
          );
        }
        if (result.errors.length) setAssetBridgeErrors((current) => [...result.errors, ...current].slice(0, 8));
        return;
      }

      if (type === "object") {
        const result = await qwenLoadRegularGalleryV2();
        setPickerAssets(result.assets);
        if (!result.assets.length) {
          setPickerError("No reusable images were found in the regular Gallery.");
        }
        if (result.errors.length) setAssetBridgeErrors((current) => [...result.errors, ...current].slice(0, 8));
        return;
      }

      if (type === "background") {
        const result = await qwenLoadBackgroundGalleryV3();
        setPickerAssets(result.assets);
        if (!result.assets.length) {
          setPickerError(
            result.ownerKey
              ? `No saved backgrounds with usable display and workflow images were found for ${result.ownerKey}.`
              : "No saved backgrounds were found for the current profile.",
          );
        }
        if (result.errors.length) setAssetBridgeErrors((current) => [...result.errors, ...current].slice(0, 8));
        return;
      }

      setPickerAssets([]);
    } finally {
      setPickerLoading(false);
    }
  }

  function openAssetPicker(type: SceneAsset["type"]) {
    setPickerPreviewAsset(null);
    setPickerType(type);
    setPickerAssets([]);
    setPickerError("");
    if (type !== "background") setBackgroundEquipNotice("");
    setAssetSearch("");
    void loadPickerAssetsV2(type);
  }

  async function submitCurrentPass(kind: "submit" | "redo" = "submit") {
    if (!selectedPass || !selectedScene) return;

    const referencesForSubmit = qwenOrderedReferencesV1(selectedPass.references);
    const rawPrompt = selectedPass.prompt.trim();
    const prompt = ensureAddToFirstImagePromptV36BPK1(rawPrompt, selectedPassIndex + 1);
    if (!rawPrompt) {
      updateSelectedPass((pass) => ({ ...pass, status: "error", error: "Prompt is required." }));
      return;
    }

    if (prompt !== rawPrompt) {
      updateSelectedPass((pass) => ({ ...pass, prompt }));
    }

    if (!referencesForSubmit.length) {
      updateSelectedPass((pass) => ({ ...pass, status: "error", error: "At least one image reference is required." }));
      return;
    }

    const selectedCharacter = referencesForSubmit.find((ref) => ref.type === "character");
    const selectedBackground = referencesForSubmit.find((ref) => ref.type === "background");
    if (!selectedCharacter || !selectedBackground) {
      updateSelectedPass((pass) => ({
        ...pass,
        status: "error",
        error: "Equip one character and one background before submitting this scene prompt.",
      }));
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
          references: referencesForSubmit.map((ref, index) => ({
            slot: index + 1,
            type: ref.type,
            name: ref.name,
            description: ref.description,
            workflowImage: normalizeImageForWorkflow(ref.workflowImage),
            previewUrl: ref.previewUrl,
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

  function addScene() {
    if (scenes.length >= MAX_SCENES) return;

    const nextIndex = scenes.length;
    setScenes((current) => (current.length >= MAX_SCENES ? current : [...current, createSceneRecord(current.length)]));
    setSelectedSceneIndex(nextIndex);
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


  const orderedSelectedReferences = selectedPass ? qwenOrderedReferencesV1(selectedPass.references) : [];
  const equippedCharacter = orderedSelectedReferences.find((ref) => ref.type === "character") || null;
  const equippedBackground = orderedSelectedReferences.find((ref) => ref.type === "background") || null;
  const sceneReferencesReady = Boolean(equippedCharacter && equippedBackground);
  const referenceCount = orderedSelectedReferences.length;
  const availableSlots = Math.max(0, MAX_REFERENCES - referenceCount);
  const addDisabled = !selectedPass || availableSlots <= 0 || selectedPass.status === "submitting";
  const pickerPreviewKey = pickerPreviewAsset ? `${pickerPreviewAsset.id}:${pickerPreviewAsset.previewUrl}` : "";
  const pickerPreviewSrc = pickerPreviewAsset ? qwenCanonicalPreviewUrlV3(otgCharacterPreviewPathV36BPA(pickerPreviewAsset)) : "";
  const pickerPreviewBroken = Boolean(pickerPreviewKey && brokenPickerPreviewKeys[pickerPreviewKey]);

  return (
    <div
      data-otg-production-vertical-stack="true"
      style={{
        display: "grid",
        gap: 14,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        overflowX: "hidden",
        color: "#f4f4f5",
      }}
    >
      <section data-otg-qwen-scene-builder="true" style={{ border: "1px solid #30323a", borderRadius: 14, padding: 14, background: "#111318", minWidth: 0 }}>
        <div style={{ display: "grid", gap: 12 }}>
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
            style={{ ...smallButtonStyle, width: "100%", minHeight: 44 }}
          >
            Reset selected scene
          </button>
        </div>

        <div data-otg-scene-stack="true" style={{ display: "grid", gap: 12, marginTop: 14 }}>
          {scenes.map((scene, index) => {
            const selected = index === selectedSceneIndex;
            return (
              <article
                key={scene.id}
                style={{
                  border: selected ? "1px solid #93c5fd" : "1px solid #30323a",
                  borderRadius: 14,
                  padding: 12,
                  background: selected ? "#172033" : "#181a20",
                  minWidth: 0,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSceneIndex(index);
                    setSelectedPassIndex(0);
                  }}
                  style={{
                    width: "100%",
                    border: 0,
                    padding: 0,
                    background: "transparent",
                    color: "#f4f4f5",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    <strong style={{ fontSize: 14 }}>{scene.name}</strong>
                    <span style={{ fontSize: 11, color: selected ? "#bfdbfe" : "#a1a1aa" }}>
                      {selected ? "Selected scene" : "Tap to select"}
                    </span>
                  </div>
                  {scene.completedImageUrl ? (
                    <img
                      src={otgComfySafeImageSrcV36BPI2(otgSceneResultImageUrlV36BPH1(otgAssetDisplayUrlV36BPA(otgDisplayImageUrlV36BP8(otgDisplayImageUrlV36BP6(scene.completedImageUrl)))))}
                      alt={scene.name}
                      style={{ background: "#050505", width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 10, marginTop: 10 }}
                    />
                  ) : (
                    <div style={{ marginTop: 10, fontSize: 12, color: "#71717a" }}>No completed scene image yet.</div>
                  )}
                </button>

                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 11, color: "#a1a1aa" }}>
                    <span style={{ textTransform: "uppercase", letterSpacing: 0.8 }}>Input scene image</span>
                    <input
                      value={scene.inputSceneImage || ""}
                      onChange={(event) => setSceneInputImage(index, event.target.value)}
                      placeholder="image filename/path/url"
                      style={{ ...inputStyle, width: "100%", minWidth: 0 }}
                    />
                  </label>

                  <label style={{ ...smallButtonStyle, display: "grid", placeItems: "center", width: "100%", minHeight: 44 }}>
                    Optional: Upload a completed scene
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
                    <button type="button" onClick={() => setSceneInputImage(index, "")} style={{ ...smallButtonStyle, width: "100%", minHeight: 44 }}>
                      Clear input image
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        <button
          type="button"
          data-otg-add-scene="true"
          onClick={addScene}
          disabled={scenes.length >= MAX_SCENES}
          style={{
            ...smallButtonStyle,
            width: "100%",
            minHeight: 48,
            marginTop: 12,
            borderColor: scenes.length >= MAX_SCENES ? "#3f3f46" : "#8b5cf6",
            background: scenes.length >= MAX_SCENES ? "#181a20" : "#4c1d95",
            opacity: scenes.length >= MAX_SCENES ? 0.55 : 1,
          }}
        >
          {scenes.length >= MAX_SCENES ? `Maximum ${MAX_SCENES} scenes reached` : `+ Add Scene (${scenes.length}/${MAX_SCENES})`}
        </button>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14, minWidth: 0 }}>
        <aside style={{ border: "1px solid #30323a", borderRadius: 14, padding: 12, background: "#111318", minWidth: 0 }}>
          <div style={{ fontSize: 12, letterSpacing: 1, color: "#a1a1aa", textTransform: "uppercase", marginBottom: 8 }}>Prompt Passes</div>
          <div style={{ display: "grid", gap: 8 }}>
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
          </div>
        </aside>

        <main style={{ display: "grid", gap: 14, minWidth: 0 }}>
          {selectedPass ? (
            <section style={{ border: "1px solid #30323a", borderRadius: 14, padding: 14, background: "#111318", minWidth: 0 }}>
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: 1 }}>Scene Prompt {selectedPassIndex + 1}</div>
                  <div style={{ color: "#a1a1aa", fontSize: 12 }}>Images equipped: {referenceCount}/3. Available: {availableSlots}.</div>
                </div>

                <div data-otg-equipped-reference-strip="true" style={{ display: "grid", gap: 8 }}>
                  {orderedSelectedReferences.length ? orderedSelectedReferences.map((ref, index) => {
                    const equippedPreview = qwenCanonicalPreviewUrlV3(otgCharacterPreviewPathV36BPA(ref));
                    return (
                      <div
                        key={`equipped-${ref.id}-${index}`}
                        data-otg-equipped-reference={ref.type}
                        style={{ display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", gap: 10, alignItems: "center", border: ref.type === "background" ? "1px solid #22c55e" : "1px solid #30323a", borderRadius: 10, padding: 8, background: ref.type === "background" ? "#0d1f16" : "#0d0f14", minWidth: 0 }}
                      >
                        {equippedPreview ? (
                          <img src={equippedPreview} alt={`${ref.name} equipped preview`} style={{ width: 72, height: 58, objectFit: "cover", borderRadius: 8, background: "#050505" }} />
                        ) : (
                          <div style={{ width: 72, height: 58, display: "grid", placeItems: "center", borderRadius: 8, background: "#050505", color: "#71717a", fontSize: 10 }}>No preview</div>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: ref.type === "background" ? "#86efac" : "#a1a1aa", textTransform: "uppercase", letterSpacing: 0.8 }}>
                            {ref.type === "background" ? "Background equipped" : ref.locked ? "Locked base equipped" : `${ref.type} equipped`}
                          </div>
                          <strong style={{ display: "block", marginTop: 2, fontSize: 13, overflowWrap: "anywhere" }}>{ref.name}</strong>
                        </div>
                      </div>
                    );
                  }) : (
                    <div style={{ border: "1px dashed #3f3f46", borderRadius: 10, padding: 10, color: "#a1a1aa", fontSize: 12 }}>No images equipped yet.</div>
                  )}
                </div>

                {sceneReferencesReady ? (
                  <div data-otg-background-submit-confirmation="true" style={{ border: "1px solid #166534", borderRadius: 10, padding: 9, background: "#07170d", color: "#bbf7d0", fontSize: 12 }}>
                    Ready: <strong>{equippedCharacter?.name}</strong> and <strong>{equippedBackground?.name}</strong> will be submitted as the character image and background image.
                  </div>
                ) : (
                  <div data-otg-scene-reference-gate="true" style={{ border: "1px solid #7c2d12", borderRadius: 10, padding: 9, background: "#1f120b", color: "#fed7aa", fontSize: 12 }}>
                    Submission is locked until one character and one background are equipped.
                  </div>
                )}

                <div style={{ display: "grid", gap: 8 }}>
                  <button type="button" title="Mic placeholder" style={{ ...smallButtonStyle, width: "100%", minHeight: 44 }}>Mic</button>
                  <button type="button" onClick={() => submitCurrentPass("submit")} disabled={selectedPass.status === "submitting" || !sceneReferencesReady} style={{ ...smallButtonStyle, width: "100%", minHeight: 44, opacity: sceneReferencesReady ? 1 : 0.55 }}>
                    {selectedPass.status === "submitting" ? "Submitting..." : sceneReferencesReady ? "Submit Prompt" : "Equip Character + Background"}
                  </button>
                  <button type="button" onClick={() => submitCurrentPass("redo")} disabled={selectedPass.status === "submitting" || !sceneReferencesReady} style={{ ...smallButtonStyle, width: "100%", minHeight: 44, opacity: sceneReferencesReady ? 1 : 0.55 }}>
                    Redo Prompt
                  </button>
                  <button type="button" onClick={passToNextPrompt} disabled={selectedPass.status === "submitting" || selectedPassIndex >= MAX_PASSES - 1} style={{ ...smallButtonStyle, width: "100%", minHeight: 44 }}>
                    Pass to Prompt {Math.min(selectedPassIndex + 2, MAX_PASSES)}
                  </button>
                  <button type="button" onClick={completeScene} disabled={selectedPass.status === "submitting"} style={{ ...smallButtonStyle, width: "100%", minHeight: 44 }}>
                    Complete Scene
                  </button>
                </div>
              </div>

              <textarea
                value={selectedPass.prompt}
                onChange={(event) => updateSelectedPass((pass) => ({ ...pass, prompt: event.target.value }))}
                placeholder="Describe only this prompt pass. Example: The dark angel and robot hover above the mansion in a storm-lit sky."
                rows={5}
                style={{ ...inputStyle, width: "100%", minWidth: 0, marginTop: 12, resize: "vertical" }}
              />

              <details style={{ marginTop: 10 }}>
                <summary style={{ color: "#a1a1aa", cursor: "pointer" }}>Negative prompt</summary>
                <textarea
                  value={selectedPass.negativePrompt}
                  onChange={(event) => updateSelectedPass((pass) => ({ ...pass, negativePrompt: event.target.value }))}
                  rows={2}
                  style={{ ...inputStyle, width: "100%", minWidth: 0, marginTop: 8, resize: "vertical" }}
                />
              </details>

              {selectedPass.error ? (
                <div style={{ marginTop: 10, border: "1px solid #7f1d1d", borderRadius: 10, padding: 10, background: "#2a1111", color: "#fecaca" }}>{selectedPass.error}</div>
              ) : null}

              {selectedPass.sentPrompt ? (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ color: "#a1a1aa", cursor: "pointer" }}>Prompt sent to workflow</summary>
                  <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "8px 0 0", padding: 10, borderRadius: 10, background: "#090a0e", color: "#d4d4d8" }}>{selectedPass.sentPrompt}</pre>
                </details>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, marginTop: 12 }}>
                {selectedPass.references.map((ref, index) => (
                  <div key={`${ref.id}-${index}`} style={{ border: ref.locked ? "1px solid #fbbf24" : "1px solid #30323a", borderRadius: 12, padding: 10, background: "#181a20", minWidth: 0 }}>
                    <div style={{ display: "grid", gap: 8 }}>
                      <strong style={{ fontSize: 12 }}>{ref.locked ? "Locked base" : ref.type}</strong>
                      {!ref.locked ? (
                        <button type="button" onClick={() => removeReference(ref.id)} style={{ ...smallButtonStyle, width: "100%", minHeight: 40 }}>
                          Remove
                        </button>
                      ) : null}
                    </div>
                    {ref.previewUrl || ref.workflowImage ? (
                      <img src={otgComfySafeImageSrcV36BPI2(otgAssetDisplayUrlV36BPA(otgCharacterPreviewPathV36BPA(ref)))} alt={ref.name} style={{ width: "100%", maxHeight: 420, objectFit: "contain", borderRadius: 8, marginTop: 8, background: "#050505", padding: 6 }} />
                    ) : null}
                    <div style={{ marginTop: 7, fontSize: 12, color: "#f4f4f5" }}>{ref.name}</div>
                    <div style={{ marginTop: 3, fontSize: 11, color: "#a1a1aa", overflowWrap: "anywhere" }}>{ref.workflowImage}</div>
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

          <section style={{ border: "1px solid #30323a", borderRadius: 14, padding: 14, background: "#111318", minWidth: 0 }}>
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: 1 }}>Add image reference</div>
                <div style={{ color: "#a1a1aa", fontSize: 12 }}>Background, character, object, and locked base all count as images. Limit is always 3.</div>
              </div>
              <div style={{ color: availableSlots <= 0 ? "#fca5a5" : "#a1a1aa", fontSize: 13 }}>{referenceCount}/3 selected</div>
            </div>

            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              <button type="button" onClick={() => openAssetPicker("character")} disabled={addDisabled} style={{ ...smallButtonStyle, width: "100%", minHeight: 44 }}>Character Gallery</button>
              <button type="button" data-otg-qwen-background-gallery="true" onClick={() => openAssetPicker("background")} disabled={!selectedPass || selectedPass.status === "submitting"} style={{ ...smallButtonStyle, width: "100%", minHeight: 44 }}>Background Gallery</button>
              <button type="button" onClick={() => openAssetPicker("object")} disabled={addDisabled} style={{ ...smallButtonStyle, width: "100%", minHeight: 44 }}>Object / Prop Gallery</button>
              <button type="button" onClick={clearUnlockedReferences} disabled={!selectedPass || selectedPass.status === "submitting"} style={{ ...smallButtonStyle, width: "100%", minHeight: 44 }}>Clear Unlocked References</button>
              <button
                type="button"
                onClick={() => pickerType ? void loadPickerAssetsV2(pickerType) : void refreshAssetBridge()}
                style={{ ...smallButtonStyle, width: "100%", minHeight: 44 }}
              >
                Refresh Galleries
              </button>
            </div>

            <div style={{ marginTop: 10, color: "#a1a1aa", fontSize: 12, lineHeight: 1.5 }}>
              Object / Prop Gallery opens the app's regular Gallery and adds a selected existing image as a reference. It does not upload images from the phone. Write text instructions in the Scene Prompt box above.
            </div>

            <details data-otg-qwen-manual-reference-advanced="true" style={{ marginTop: 10, border: "1px solid #30323a", borderRadius: 10, padding: 10, background: "#0d0f14" }}>
              <summary style={{ color: "#d4d4d8", cursor: "pointer", fontSize: 12, fontWeight: 800 }}>
                Advanced: Add a manual image reference
              </summary>
              <p style={{ margin: "8px 0 0", color: "#a1a1aa", fontSize: 12, lineHeight: 1.5 }}>
                Use this only when the image is not available in a gallery. Type tells Qwen whether the image is a character, background, or object. Name is the visible label. Workflow image is the exact file path or image URL ComfyUI must load. Description tells Qwen what must remain consistent.
              </p>

              <div style={{ marginTop: 8, color: "#a1a1aa", fontSize: 12 }}>{assetBridgeStatus}</div>
              {assetBridgeErrors.length ? (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ color: "#a1a1aa", cursor: "pointer", fontSize: 12 }}>Gallery API diagnostics</summary>
                  <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11, color: "#a1a1aa" }}>{assetBridgeErrors.join("\n")}</pre>
                </details>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, marginTop: 10 }}>
                <label style={{ display: "grid", gap: 5, color: "#a1a1aa", fontSize: 11 }}>
                  <span>Reference type</span>
                  <select value={manual.type} onChange={(event) => setManual((current) => ({ ...current, type: event.target.value as ManualReferenceForm["type"] }))} disabled={addDisabled} style={{ ...inputStyle, width: "100%" }}>
                    <option value="character">Character</option>
                    <option value="background">Background</option>
                    <option value="object">Object / Prop</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 5, color: "#a1a1aa", fontSize: 11 }}>
                  <span>Reference name</span>
                  <input value={manual.name} onChange={(event) => setManual((current) => ({ ...current, name: event.target.value }))} placeholder="Example: bi, burning Tokyo, red sword" disabled={addDisabled} style={{ ...inputStyle, width: "100%" }} />
                </label>
                <label style={{ display: "grid", gap: 5, color: "#a1a1aa", fontSize: 11 }}>
                  <span>Workflow image file or URL</span>
                  <input value={manual.workflowImage} onChange={(event) => setManual((current) => ({ ...current, workflowImage: event.target.value }))} placeholder="Exact file path, filename, or image URL" disabled={addDisabled} style={{ ...inputStyle, width: "100%" }} />
                </label>
              </div>
              <label style={{ display: "grid", gap: 5, marginTop: 8, color: "#a1a1aa", fontSize: 11 }}>
                <span>Reference description</span>
                <textarea
                  value={manual.description}
                  onChange={(event) => setManual((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Describe the character or object and what must stay consistent. Background description is optional."
                  rows={2}
                  disabled={addDisabled}
                  style={{ ...inputStyle, width: "100%", resize: "vertical" }}
                />
              </label>
              <button type="button" onClick={addManualReference} disabled={addDisabled} style={{ ...smallButtonStyle, marginTop: 8, width: "100%", minHeight: 44 }}>
                Add Manual Reference
              </button>
            </details>

            {pickerType ? (
              <div style={{ marginTop: 14, border: "1px solid #30323a", borderRadius: 12, padding: 10, background: "#0d0f14", minWidth: 0 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: 1 }}>
                      {pickerType === "character" ? "Character Gallery" : pickerType === "object" ? "Object / Prop Gallery - Regular Gallery" : "Background Gallery"}
                    </div>
                    <div style={{ color: "#a1a1aa", fontSize: 12 }}>
                      {pickerLoading
                        ? "Loading..."
                        : pickerType === "background"
                          ? `${filteredDetectedAssets.length} saved background(s). Tap the background image, card, or Equip Background button to attach it to this prompt.`
                          : `${filteredDetectedAssets.length} matching image(s). Add is disabled only at 3/3 or while submitting.`}
                    </div>
                  </div>
                  {pickerType === "background" && equippedBackground ? (
                    <div data-otg-background-picker-confirmation="true" style={{ border: "2px solid #22c55e", borderRadius: 10, padding: 10, background: "#0b2415", color: "#bbf7d0", fontSize: 13 }}>
                      ✓ Selected background: <strong>{equippedBackground.name}</strong>. It is attached to Prompt {selectedPassIndex + 1}.
                    </div>
                  ) : null}
                  {pickerType === "background" && backgroundEquipNotice ? (
                    <div role="status" aria-live="polite" style={{ border: "1px solid #16a34a", borderRadius: 10, padding: 9, background: "#07170d", color: "#dcfce7", fontSize: 12 }}>
                      {backgroundEquipNotice}
                    </div>
                  ) : null}
                  <button type="button" onClick={() => { setPickerPreviewAsset(null); setPickerType(null); }} style={{ ...smallButtonStyle, width: "100%", minHeight: 44 }}>
                    {pickerType === "background" && equippedBackground ? "Done - Keep Selected Background" : "Close Picker"}
                  </button>
                </div>
                <input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search gallery" style={{ ...inputStyle, width: "100%", marginTop: 10 }} />
                {pickerError ? (
                  <div style={{ marginTop: 12, border: "1px solid #7f1d1d", borderRadius: 10, padding: 10, background: "#1f1113", color: "#fecaca", fontSize: 13, lineHeight: 1.5 }}>
                    {pickerError}
                  </div>
                ) : null}
                {!pickerLoading && filteredDetectedAssets.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, marginTop: 10 }}>
                    {filteredDetectedAssets.slice(0, 100).map((asset) => {
                      const previewKey = `${asset.id}:${asset.previewUrl}`;
                      const previewSrc = qwenCanonicalPreviewUrlV3(otgCharacterPreviewPathV36BPA(asset));
                      const previewBroken = Boolean(brokenPickerPreviewKeys[previewKey]);
                      const equipped = Boolean(selectedPass?.references.some((ref) => referenceKey(ref) === referenceKey(asset)));
                      const canReplaceBackground = asset.type === "background";
                      const equipDisabled = selectedPass?.status === "submitting" || equipped || (!canReplaceBackground && addDisabled);
                      const equipBackgroundFromCard = () => {
                        if (asset.type !== "background" || equipDisabled) return;
                        addReference(asset);
                      };

                      return (
                        <div
                          key={`${asset.id}-${asset.workflowImage}`}
                          role={asset.type === "background" ? "button" : undefined}
                          tabIndex={asset.type === "background" && !equipDisabled ? 0 : undefined}
                          aria-pressed={asset.type === "background" ? equipped : undefined}
                          data-otg-background-picker-card={asset.type === "background" ? "true" : undefined}
                          onClick={equipBackgroundFromCard}
                          onKeyDown={(event) => {
                            if (asset.type !== "background" || equipDisabled) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              addReference(asset);
                            }
                          }}
                          style={{
                            border: equipped ? "2px solid #22c55e" : "1px solid #30323a",
                            borderRadius: 12,
                            padding: 10,
                            background: equipped ? "#0b2415" : "#181a20",
                            minWidth: 0,
                            cursor: asset.type === "background" && !equipDisabled ? "pointer" : "default",
                            boxShadow: equipped ? "0 0 0 2px rgba(34, 197, 94, 0.18)" : undefined,
                          }}
                        >
                          {previewSrc && !previewBroken ? (
                            <button
                              type="button"
                              aria-label={asset.type === "background" ? `Equip ${asset.name}` : `View ${asset.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (asset.type === "background") addReference(asset);
                                else setPickerPreviewAsset(asset);
                              }}
                              style={{ display: "block", width: "100%", border: 0, padding: 0, background: "transparent", cursor: asset.type === "background" ? "pointer" : "zoom-in" }}
                            >
                              <img
                                src={previewSrc}
                                alt={asset.name}
                                draggable={false}
                                onError={() => setBrokenPickerPreviewKeys((current) => ({ ...current, [previewKey]: true }))}
                                style={{ width: "100%", maxHeight: 420, objectFit: "contain", borderRadius: 8, background: "#050505", padding: 6 }}
                              />
                            </button>
                          ) : (
                            <div style={{ display: "grid", minHeight: 130, placeItems: "center", borderRadius: 8, background: "#090a0e", padding: 12, color: "#fca5a5", textAlign: "center", fontSize: 12 }}>
                              Preview unavailable. The saved workflow image can still be added.
                            </div>
                          )}
                          {equipped ? (
                            <div data-otg-background-selected-badge="true" style={{ marginTop: 8, borderRadius: 999, padding: "6px 10px", background: "#16a34a", color: "#ffffff", fontSize: 12, fontWeight: 800, textAlign: "center" }}>
                              ✓ Selected for Prompt {selectedPassIndex + 1}
                            </div>
                          ) : null}
                          <div style={{ marginTop: 7, fontSize: 12, color: "#f4f4f5" }}>{asset.name}</div>
                          <div style={{ fontSize: 11, color: "#a1a1aa" }}>{asset.type} · {asset.source}</div>
                          <div style={{ marginTop: 4, fontSize: 10, color: "#71717a", overflowWrap: "anywhere" }}>{asset.workflowImage}</div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPickerPreviewAsset(asset);
                            }}
                            disabled={!previewSrc || previewBroken}
                            style={{ ...smallButtonStyle, marginTop: 8, width: "100%", minHeight: 44, opacity: !previewSrc || previewBroken ? 0.55 : 1 }}
                          >
                            View Image
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              addReference(asset);
                            }}
                            disabled={equipDisabled}
                            data-otg-equip-reference-button={asset.type}
                            style={{ ...smallButtonStyle, marginTop: 8, width: "100%", minHeight: 44, borderColor: equipped ? "#22c55e" : undefined, background: equipped ? "#12351f" : smallButtonStyle.background }}
                          >
                            {equipped
                              ? `${asset.type === "background" ? "✓ Background Selected" : `${asset.type} Equipped`}`
                              : asset.type === "background"
                                ? "Equip Background to Prompt"
                                : `Add ${asset.type}`}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : !pickerLoading && !pickerError ? (
                  <div style={{ marginTop: 12, color: "#a1a1aa", fontSize: 13 }}>
                    {pickerType === "character"
                      ? "No saved character images were found for the current profile."
                      : pickerType === "object"
                        ? "No still images were found in the regular Gallery."
                        : "No saved background images were found."}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </main>
      </section>

      {pickerPreviewAsset ? (
        <div
          data-otg-qwen-gallery-viewer="true"
          role="dialog"
          aria-modal="true"
          aria-label={`${pickerPreviewAsset.name} image viewer`}
          onClick={() => setPickerPreviewAsset(null)}
          style={{ position: "fixed", inset: 0, zIndex: 220, display: "grid", alignItems: "start", overflowY: "auto", background: "rgba(0, 0, 0, 0.88)", padding: 12 }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ width: "100%", maxWidth: 1100, margin: "0 auto", border: "1px solid #3f3f46", borderRadius: 14, background: "#090a0e", overflow: "hidden" }}
          >
            <div style={{ position: "sticky", top: 0, zIndex: 2, display: "grid", gap: 8, padding: 10, background: "rgba(9, 10, 14, 0.98)", borderBottom: "1px solid #30323a" }}>
              <div style={{ color: "#f4f4f5", fontWeight: 800, overflowWrap: "anywhere" }}>{pickerPreviewAsset.name}</div>
              <button
                type="button"
                aria-label="Close image viewer"
                onClick={() => setPickerPreviewAsset(null)}
                style={{ ...smallButtonStyle, width: "100%", minHeight: 48, borderColor: "#f87171", background: "#3f1518" }}
              >
                Close Image Viewer ✕
              </button>
            </div>

            <div style={{ display: "grid", placeItems: "center", minHeight: 220, padding: 10 }}>
              {pickerPreviewSrc && !pickerPreviewBroken ? (
                <img
                  src={pickerPreviewSrc}
                  alt={pickerPreviewAsset.name}
                  draggable={false}
                  onError={() => pickerPreviewKey && setBrokenPickerPreviewKeys((current) => ({ ...current, [pickerPreviewKey]: true }))}
                  style={{ display: "block", width: "100%", maxWidth: "100%", maxHeight: "calc(100vh - 150px)", objectFit: "contain", borderRadius: 10, background: "#050505" }}
                />
              ) : (
                <div style={{ padding: 24, color: "#fca5a5", textAlign: "center" }}>
                  This saved background preview could not be loaded. Close the viewer and use Refresh Galleries after the source image is repaired.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setPickerPreviewAsset(null)}
              style={{ ...smallButtonStyle, width: "calc(100% - 20px)", minHeight: 48, margin: "0 10px 10px" }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const smallButtonStyle: React.CSSProperties = {
  boxSizing: "border-box",
  border: "1px solid #3f3f46",
  borderRadius: 10,
  padding: "7px 10px",
  background: "#181a20",
  color: "#f4f4f5",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  boxSizing: "border-box",
  minWidth: 0,
  border: "1px solid #30323a",
  borderRadius: 10,
  background: "#090a0e",
  color: "#f4f4f5",
  padding: "8px 10px",
};
