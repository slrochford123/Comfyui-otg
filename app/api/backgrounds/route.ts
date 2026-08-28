import { createHash } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import {
  backgroundAssetDir,
  backgroundUploadDir,
  backgroundImageUrlForPath,
  deleteBackground,
  hasUsableBackgroundImageV36AO,
  isAllowedBackgroundImageExt,
  listBackgrounds,
  safeBackgroundAssetName,
  saveBackground,
  type BackgroundRecordInputV36B,
  type BackgroundRecordV36B,
} from "@/lib/backgrounds/store";
import {
  canonicalBackgroundFrontAsset,
  canonicalBackgroundPersistenceFields,
} from "@/lib/backgrounds/canonicalCardPersistence";
import { SessionInvalidError } from "@/lib/ownerKey";
import { getOwnerDirs } from "@/lib/paths";
import { requireSessionUser } from "@/lib/sessionUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "private, no-store",
      ...(init?.headers || {}),
    },
  });
}

function cleanString(value: unknown) {
  return String(value || "").trim();
}

async function authenticatedOwner(req: NextRequest) {
  const owner = await requireSessionUser(req);
  if (owner.scope !== "user" || !owner.username) {
    throw new SessionInvalidError("An authenticated Background account is required.");
  }
  return owner;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const text = cleanString(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }

  return output;
}

function configuredComfyBaseUrls(req: NextRequest) {
  return uniqueStrings([
    req.nextUrl.origin,
    process.env.COMFYUI_BASE_URL,
    process.env.COMFY_BASE_URL,
    process.env.COMFY_IMAGE_BASE_URL,
    process.env.COMFY_VIDEO_PRIMARY_BASE_URL,
    process.env.COMFY_VIDEO_FALLBACK_BASE_URL,
    process.env.NEXT_PUBLIC_COMFYUI_BASE_URL,
    "http://100.75.162.64:8188",
    "http://192.168.1.113:8188",
    "http://127.0.0.1:8188",
  ]).map((value) => value.replace(/\/+$/, ""));
}

function isAllowedRemoteUrl(req: NextRequest, target: URL) {
  if (!/^https?:$/.test(target.protocol)) return false;
  return configuredComfyBaseUrls(req).some((base) => {
    try {
      return new URL(base).origin === target.origin;
    } catch {
      return false;
    }
  });
}

function localPathFromReference(value: string) {
  const text = cleanString(value);
  if (!text) return "";

  if (path.isAbsolute(text) && !text.startsWith("/api/")) {
    return path.resolve(text);
  }

  try {
    const parsed = new URL(text, "http://otg.local");
    if (parsed.pathname === "/api/file") {
      const filePath = cleanString(parsed.searchParams.get("path"));
      return filePath ? path.resolve(filePath) : "";
    }
  } catch {
    return "";
  }

  return "";
}

function configuredBackgroundImportRoots(ownerKey: string) {
  const ownerDirs = getOwnerDirs(ownerKey);
  const envRoots = cleanString(process.env.OTG_GALLERY_IMPORT_ROOTS)
    .split(/[;\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return uniqueStrings([
    backgroundAssetDir(ownerKey),
    backgroundUploadDir(ownerKey),
    ownerDirs.gallery,
    ownerDirs.inbox,
    ownerDirs.favorites,
    ownerDirs.preview,
    process.env.COMFY_OUTPUT_DIR,
    process.env.OTG_COMFY_OUTPUT_DIR,
    process.env.ADMIN_GALLERY_ROOT,
    ...envRoots,
  ]).map((root) => path.resolve(root));
}

function resolveAllowedLocalImagePath(ownerKey: string, candidate: string) {
  const resolved = path.resolve(candidate);
  if (!isAllowedBackgroundImageExt(path.extname(resolved))) {
    throw new Error("Background local import must use an approved image extension.");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("Background local import file does not exist.");
  }

  const realFile = fs.realpathSync(resolved);
  const allowed = configuredBackgroundImportRoots(ownerKey).some((root) => {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return false;
    const realRoot = fs.realpathSync(root);
    const relative = path.relative(realRoot, realFile);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });

  if (!allowed) {
    throw new Error("Background local import path is outside approved media roots.");
  }
  return realFile;
}

function fileNameFromReference(value: string, role: "display" | "workflow") {
  const text = cleanString(value);
  if (!text) return `background-${role}.png`;

  try {
    const parsed = new URL(text, "http://otg.local");
    const queryName = cleanString(parsed.searchParams.get("filename"));
    if (queryName) return path.basename(queryName);
    const pathName = path.basename(parsed.pathname);
    if (pathName && pathName.includes(".")) return pathName;
  } catch {
    const base = path.basename(text.replace(/\\/g, "/"));
    if (base) return base;
  }

  return `background-${role}.png`;
}

function extensionForContentType(contentType: string) {
  const type = contentType.toLowerCase();
  if (type.includes("image/jpeg")) return ".jpg";
  if (type.includes("image/webp")) return ".webp";
  if (type.includes("image/bmp")) return ".bmp";
  return ".png";
}

type ResolvedBackgroundBytes = {
  bytes: Buffer;
  sourceName: string;
  contentType: string;
};

async function fetchImageBytes(req: NextRequest, ownerKey: string, source: string): Promise<ResolvedBackgroundBytes> {
  const localPath = localPathFromReference(source);

  if (localPath) {
    const allowedPath = resolveAllowedLocalImagePath(ownerKey, localPath);
    return {
      bytes: await fsPromises.readFile(allowedPath),
      sourceName: path.basename(allowedPath),
      contentType: "",
    };
  }

  const parsed = new URL(source, req.nextUrl.origin);

  if (parsed.pathname === "/api/comfy/history-image") {
    const filename = cleanString(parsed.searchParams.get("filename"));
    const type = cleanString(parsed.searchParams.get("type")) || "output";
    const subfolder = cleanString(parsed.searchParams.get("subfolder"));
    const requestedBase = cleanString(parsed.searchParams.get("comfyBaseUrl"));
    const base = requestedBase || configuredComfyBaseUrls(req).find((value) => value.endsWith(":8188")) || "";

    if (!filename || !base) {
      throw new Error("Background Comfy history reference is missing filename or backend URL.");
    }

    const target = new URL(`${base.replace(/\/+$/, "")}/view`);
    target.searchParams.set("filename", filename);
    target.searchParams.set("type", type);
    target.searchParams.set("subfolder", subfolder);

    if (!isAllowedRemoteUrl(req, target)) {
      throw new Error(`Background image backend is not allowed: ${target.origin}`);
    }

    const response = await fetch(target, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Background image fetch failed from ComfyUI (${response.status}): ${filename}`);
    }
    const contentType = cleanString(response.headers.get("content-type"));
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new Error("Background image backend returned non-image content.");
    }

    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      sourceName: filename,
      contentType,
    };
  }

  if (!isAllowedRemoteUrl(req, parsed)) {
    throw new Error(`Background image URL is not allowed: ${parsed.origin}`);
  }

  const response = await fetch(parsed, {
    cache: "no-store",
    headers: {
      "x-otg-device-id": cleanString(req.headers.get("x-otg-device-id")),
    },
  });

  if (!response.ok) {
    throw new Error(`Background image fetch failed (${response.status}): ${parsed.pathname}`);
  }
  const contentType = cleanString(response.headers.get("content-type"));
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error("Background image URL returned non-image content.");
  }

  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    sourceName: fileNameFromReference(source, "display"),
    contentType,
  };
}

type StableBackgroundAsset = {
  imagePath: string;
  imageUrl: string;
};

function stableAssetFromExistingReference(ownerKey: string, source: string): StableBackgroundAsset | null {
  const filePath = localPathFromReference(source);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;

  const assetRoot = fs.realpathSync(backgroundAssetDir(ownerKey));
  const resolved = fs.realpathSync(filePath);
  const relative = path.relative(assetRoot, resolved);
  const insideAssetRoot = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

  if (!insideAssetRoot) return null;

  return {
    imagePath: resolved,
    imageUrl: backgroundImageUrlForPath(resolved),
  };
}

async function persistBackgroundReference(args: {
  req: NextRequest;
  ownerKey: string;
  recordId: string;
  role: string;
  source: string;
}): Promise<StableBackgroundAsset | null> {
  const source = cleanString(args.source);
  if (!source) return null;

  const existing = stableAssetFromExistingReference(args.ownerKey, source);
  if (existing) return existing;

  const resolved = await fetchImageBytes(args.req, args.ownerKey, source);
  if (!resolved.bytes.length) {
    throw new Error(`Background ${args.role} image is empty.`);
  }

  const digest = createHash("sha256").update(resolved.bytes).digest("hex").slice(0, 16);
  const originalName =
    resolved.sourceName ||
    fileNameFromReference(
      source,
      args.role === "display" ? "display" : "workflow",
    );
  const parsedName = path.parse(originalName);
  const sourceExt = parsedName.ext || extensionForContentType(resolved.contentType);
  const desiredName = safeBackgroundAssetName(
    `${args.recordId}-${args.role}-${digest}${sourceExt}`,
    `${args.recordId}-${args.role}`,
  );
  const outputDir = backgroundAssetDir(args.ownerKey);
  const outputPath = path.join(outputDir, desiredName);

  if (!fs.existsSync(outputPath)) {
    const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
    await fsPromises.writeFile(tempPath, resolved.bytes);
    await fsPromises.rename(tempPath, outputPath);
  }

  return {
    imagePath: outputPath,
    imageUrl: backgroundImageUrlForPath(outputPath),
  };
}

function displayReferenceFromRecord(input: any) {
  const canonicalFront = canonicalBackgroundFrontAsset(input);

  return cleanString(
    input?.establishingImage?.displayImage ||
      input?.establishingImage?.imageUrl ||
      input?.displayImage ||
      input?.imageUrl ||
      input?.establishingImage?.imagePath ||
      input?.imagePath ||
      input?.workflowImage ||
      canonicalFront?.displayImage ||
      canonicalFront?.imageUrl ||
      canonicalFront?.imagePath ||
      canonicalFront?.workflowImage,
  );
}

function workflowReferenceFromRecord(input: any) {
  const canonicalFront = canonicalBackgroundFrontAsset(input);

  return cleanString(
    input?.panoramaImage?.workflowImage ||
      input?.panoramaImage?.imagePath ||
      input?.workflowImage ||
      input?.establishingImage?.workflowImage ||
      input?.imagePath ||
      input?.displayImage ||
      input?.imageUrl ||
      canonicalFront?.workflowImage ||
      canonicalFront?.imagePath ||
      canonicalFront?.imageUrl ||
      canonicalFront?.displayImage,
  );
}

async function canonicalizeBackgroundRecord(
  req: NextRequest,
  ownerKey: string,
  input: BackgroundRecordInputV36B,
  strict = false,
): Promise<BackgroundRecordInputV36B> {
  const recordId = cleanString(input.id) || `background-${Date.now()}`;
  const displaySource = displayReferenceFromRecord(input);
  const workflowSource = workflowReferenceFromRecord(input);

  let displayAsset: StableBackgroundAsset | null = null;
  let workflowAsset: StableBackgroundAsset | null = null;

  if (displaySource) {
    try {
      displayAsset = await persistBackgroundReference({
        req,
        ownerKey,
        recordId,
        role: "display",
        source: displaySource,
      });
    } catch (error: any) {
      if (strict) throw error;
      console.warn("[background-library] display_asset_repair_failed", {
        ownerKey,
        recordId,
        source: displaySource,
        error: error?.message || String(error),
      });
    }
  }

  if (workflowSource) {
    if (workflowSource === displaySource && displayAsset) {
      workflowAsset = displayAsset;
    } else {
      try {
        workflowAsset = await persistBackgroundReference({
          req,
          ownerKey,
          recordId,
          role: "workflow",
          source: workflowSource,
        });
      } catch (error: any) {
        if (strict) throw error;
        console.warn("[background-library] workflow_asset_repair_failed", {
          ownerKey,
          recordId,
          source: workflowSource,
          error: error?.message || String(error),
        });
      }
    }
  }

  const canonicalAngleImages: Record<string, any> = {
    ...(
      input.angleImages &&
      typeof input.angleImages === "object" &&
      !Array.isArray(input.angleImages)
        ? input.angleImages
        : {}
    ),
  };

  const allowedAngleKeys = [
    "front",
    "left45",
    "right45",
    "left90",
    "right90",
    "back",
    "up",
    "down",
    "low",
    "high",
    "close",
  ] as const;

  if (
    input.angleImages &&
    typeof input.angleImages === "object" &&
    !Array.isArray(input.angleImages)
  ) {
    for (const key of allowedAngleKeys) {
      const sourceAsset = (input.angleImages as any)[key];
      if (!sourceAsset || typeof sourceAsset !== "object") continue;

      const angleSource = cleanString(
        sourceAsset.workflowImage ||
          sourceAsset.imagePath ||
          sourceAsset.imageUrl ||
          sourceAsset.displayImage,
      );

      if (!angleSource) continue;

      try {
        let stableAngleAsset: StableBackgroundAsset | null = null;

        if (angleSource === displaySource && displayAsset) {
          stableAngleAsset = displayAsset;
        } else if (angleSource === workflowSource && workflowAsset) {
          stableAngleAsset = workflowAsset;
        } else {
          stableAngleAsset = await persistBackgroundReference({
            req,
            ownerKey,
            recordId,
            role: `angle-${key}`,
            source: angleSource,
          });
        }

        if (stableAngleAsset) {
          canonicalAngleImages[key] = {
            displayImage: stableAngleAsset.imageUrl,
            workflowImage: stableAngleAsset.imagePath,
            imagePath: stableAngleAsset.imagePath,
            imageUrl: stableAngleAsset.imageUrl,
          };
        }
      } catch (error: any) {
        if (strict) throw error;

        console.warn("[background-library] angle_asset_repair_failed", {
          ownerKey,
          recordId,
          key,
          source: angleSource,
          error: error?.message || String(error),
        });
      }
    }
  }

  displayAsset ||= workflowAsset;
  workflowAsset ||= displayAsset;

  if (!displayAsset || !workflowAsset) {
    return {
      ...input,
      angleImages: canonicalAngleImages,
    };
  }

  return {
    ...input,
    displayImage: displayAsset.imageUrl,
    imageUrl: displayAsset.imageUrl,
    imagePath: displayAsset.imagePath,
    workflowImage: workflowAsset.imagePath,
    establishingImage: {
      displayImage: displayAsset.imageUrl,
      workflowImage: displayAsset.imagePath,
      imagePath: displayAsset.imagePath,
      imageUrl: displayAsset.imageUrl,
    },
    panoramaImage: {
      displayImage: workflowAsset.imageUrl,
      workflowImage: workflowAsset.imagePath,
      imagePath: workflowAsset.imagePath,
      imageUrl: workflowAsset.imageUrl,
    },
    angleImages: canonicalAngleImages,
  };
}

function recordNeedsCanonicalAssets(ownerKey: string, record: BackgroundRecordV36B) {
  const display = displayReferenceFromRecord(record);
  const workflow = workflowReferenceFromRecord(record);

  if (
    !stableAssetFromExistingReference(ownerKey, display) ||
    !stableAssetFromExistingReference(ownerKey, workflow)
  ) {
    return true;
  }

  for (const asset of Object.values(record.angleImages || {})) {
    const source = cleanString(
      asset?.workflowImage ||
        asset?.imagePath ||
        asset?.imageUrl ||
        asset?.displayImage,
    );

    if (source && !stableAssetFromExistingReference(ownerKey, source)) {
      return true;
    }
  }

  return false;
}

async function listAndRepairBackgrounds(req: NextRequest, ownerKey: string) {
  const items = listBackgrounds(ownerKey);
  const repaired: BackgroundRecordV36B[] = [];

  for (const item of items) {
    if (!recordNeedsCanonicalAssets(ownerKey, item)) {
      repaired.push(item);
      continue;
    }

    try {
      const canonical = await canonicalizeBackgroundRecord(req, ownerKey, item);
      const saved = saveBackground(ownerKey, canonical);
      repaired.push(saved);
      console.info("[background-library] canonicalized", {
        ownerKey,
        id: saved.id,
        displayImage: saved.displayImage,
        workflowImage: saved.workflowImage,
      });
    } catch (error: any) {
      console.warn("[background-library] canonicalize_failed", {
        ownerKey,
        id: item.id,
        error: error?.message || String(error),
      });
      repaired.push(item);
    }
  }

  return repaired;
}

export async function GET(req: NextRequest) {
  try {
    const owner = await authenticatedOwner(req);
    return noStore({
      ok: true,
      items: await listAndRepairBackgrounds(req, owner.ownerKey),
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return noStore({ ok: false, error: error?.message || "Could not list backgrounds." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const owner = await authenticatedOwner(req);
    const body = await req.json().catch(() => ({}));
    const action = cleanString(body?.action || "save").toLowerCase();

    if (action === "delete") {
      const id = cleanString(body?.id);
      if (!id) return noStore({ ok: false, error: "Background id is required." }, { status: 400 });

      const deleted = deleteBackground(owner.ownerKey, id);
      console.info("[background-library] delete", {
        ownerKey: owner.ownerKey,
        scope: owner.scope,
        id,
        deleted,
      });
      return noStore({
        ok: true,
        deleted,
        ownerKey: owner.ownerKey,
        items: await listAndRepairBackgrounds(req, owner.ownerKey),
      });
    }

    if (action !== "save" && action !== "create") {
      return noStore({ ok: false, error: `Unsupported action: ${action}` }, { status: 400 });
    }

    const requestedInput = (body?.background || body) as BackgroundRecordInputV36B;
    const persistenceFields = canonicalBackgroundPersistenceFields(requestedInput);
    const requested = persistenceFields.establishingImage
      ? ({
          ...requestedInput,
          displayImage:
            cleanString(requestedInput.displayImage) ||
            persistenceFields.displayImage,
          workflowImage:
            cleanString(requestedInput.workflowImage) ||
            persistenceFields.workflowImage,
          imagePath:
            cleanString(requestedInput.imagePath) ||
            persistenceFields.imagePath,
          imageUrl:
            cleanString(requestedInput.imageUrl) ||
            persistenceFields.imageUrl,
          establishingImage:
            requestedInput.establishingImage ||
            persistenceFields.establishingImage,
        } as BackgroundRecordInputV36B)
      : requestedInput;
    const canonical = await canonicalizeBackgroundRecord(req, owner.ownerKey, requested, true);
    const background = saveBackground(owner.ownerKey, canonical);

    if (!hasUsableBackgroundImageV36AO(background)) {
      return noStore({
        ok: false,
        error: "Background save produced no usable display or workflow image.",
      }, { status: 422 });
    }

    console.info("[background-library] save", {
      ownerKey: owner.ownerKey,
      scope: owner.scope,
      id: background.id,
      hasDisplayImage: Boolean(background.displayImage || background.establishingImage?.displayImage),
      hasWorkflowImage: Boolean(background.workflowImage || background.panoramaImage?.workflowImage),
      canonicalDisplayImage: background.displayImage,
      canonicalWorkflowImage: background.workflowImage,
    });

    return noStore({
      ok: true,
      ownerKey: owner.ownerKey,
      background,
      items: await listAndRepairBackgrounds(req, owner.ownerKey),
    }, { status: 201 });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return noStore({ ok: false, error: error?.message || "Could not save background." }, { status: 500 });
  }
}

// OTG_BACKGROUND_STABLE_ASSET_CANONICALIZATION_V36BPI1
// OTG_BACKGROUND_OWNER_SCOPED_ROUTE_LOGGING_V36AO
// OTG_BACKGROUND_IMPORT_EXACT_ORIGIN_AND_MEDIA_ROOTS_V36BSEC1
