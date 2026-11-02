import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { withOwner, RequestError } from "@/lib/routeSecurity";
import { limitedJson, limitedBytes } from "@/lib/limitedRequestBody";
import { assertOwnerMediaFile } from "@/lib/ownerMediaAccess";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { serveOwnedComfyMedia } from "@/lib/comfyMediaAccess";
import { GET as ownedFile } from "@/app/api/file/route";
import { GET as galleryFile } from "@/app/api/gallery/file/route";
import type { OwnerContext } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function json(status: number, body: JsonRecord) {
  return NextResponse.json(body, { status });
}

function safeSlug(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return slug || "character";
}

function splitCommand(value: string) {
  const parts = value.match(/"[^"]+"|'[^']+'|\S+/g) || [];
  return parts.map((part) => part.replace(/^["']|["']$/g, ""));
}

async function readImageBytes(request: NextRequest, imageRef: string, owner: OwnerContext) {
  const limit = 16 * 1024 * 1024;
  let bytes: Buffer;
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(imageRef)) {
    if (imageRef.length > limit * 1.4) throw new RequestError("Image exceeds the 16 MB limit.", 413);
    bytes = Buffer.from(imageRef.slice(imageRef.indexOf(",") + 1), "base64");
  } else {
    let response: Response;
    const url = new URL(imageRef, request.url);
    if (url.origin !== request.nextUrl.origin) throw new RequestError("Upload the image or choose an image from your gallery first.", 400);
    const localRequest = new NextRequest(url, { headers: request.headers, signal: request.signal });
    if (url.pathname === "/api/file") response = await ownedFile(localRequest);
    else if (url.pathname === "/api/gallery/file") response = await galleryFile(localRequest);
    else if (["/api/comfy/view", "/api/comfy-image"].includes(url.pathname)) response = await serveOwnedComfyMedia(localRequest, owner);
    else if (path.isAbsolute(imageRef)) {
      try { assertOwnerMediaFile(imageRef, owner.ownerKey); } catch { throw new RequestError("Image not found for this account.", 404); }
      if ((await fs.stat(imageRef)).size > limit) throw new RequestError("Image exceeds the 16 MB limit.", 413);
      bytes = await fs.readFile(imageRef);
      await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
      return bytes;
    } else {
      const mediaUrl = new URL("/api/comfy/view", request.url);
      mediaUrl.searchParams.set("filename", imageRef);
      response = await serveOwnedComfyMedia(new NextRequest(mediaUrl, { headers: request.headers, signal: request.signal }), owner);
    }
    if (!response.ok || !response.body) throw new RequestError("Image not available for this account.", response.status === 401 ? 401 : 404);
    const bounded = new Request(request.url, { method: "POST", body: response.body, headers: response.headers, signal: request.signal, duplex: "half" } as RequestInit);
    bytes = Buffer.from(await limitedBytes(bounded, limit));
  }
  try { await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata(); }
  catch { throw new RequestError("Choose a valid image within the 40 megapixel limit.", 400); }
  return bytes;
}

function runRembg(inputPath: string, outputPath: string) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string }>((resolve) => {
    const configured = asString(process.env.OTG_REMBG_COMMAND);
    const commandParts = configured ? splitCommand(configured) : ["rembg"];
    const exe = commandParts[0] || "rembg";
    const baseArgs = commandParts.slice(1);
    const args = baseArgs.length ? [...baseArgs, inputPath, outputPath] : ["i", inputPath, outputPath];

    let stdout = "";
    let stderr = "";

    const child = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CUDA_VISIBLE_DEVICES: "" } });
    const timeout = setTimeout(() => child.kill("SIGTERM"), 60_000);
    const forceTimeout = setTimeout(() => child.kill("SIGKILL"), 65_000);
    const clearTimers = () => { clearTimeout(timeout); clearTimeout(forceTimeout); };
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + String(chunk)).slice(-8000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-8000);
    });
    child.on("error", (error) => {
      clearTimers();
      resolve({ ok: false, stdout, stderr: stderr + String(error?.message || error) });
    });
    child.on("close", (code) => {
      clearTimers();
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

export const POST = withOwner(async (request, owner) => {
  let tempDir = "";

  try {
    const body = await limitedJson(request, 24 * 1024 * 1024);
    const data = isRecord(body) ? body : {};
    const characterName = asString(data.characterName || data.name) || "character";
    const imageRef = asString(
      data.defaultCharacterSourceImagePath ||
        data.uploadedCharacterImagePath ||
        data.uploadedFullBodyPath ||
        data.sourceCharacterImagePath ||
        data.imageUrl ||
        data.characterCardPath ||
        data.characterCardWorkflowImagePath ||
        data.characterCardImage ||
        data.workflowImage ||
        data.imagePath,
    );

    if (!imageRef) {
      return json(400, { ok: false, error: "character image reference is required" });
    }

    const workflowCardRef =
      asString(data.characterCardPath || data.characterCardWorkflowImagePath || data.workflowImage || data.imagePath) ||
      imageRef;

    if (process.env.OTG_CHARACTER_DEFAULT_IMAGE_NOOP === "1") {
      return json(200, {
        ok: true,
        backgroundRemoved: false,
        fallback: true,
        defaultCharacterImagePath: imageRef,
        defaultCharacterPreviewImagePath: imageRef,
        backgroundRemovedDefaultImagePath: imageRef,
        characterCardWorkflowImagePath: workflowCardRef,
        defaultCharacterImageStatus: "fallback_original_card",
      });
    }

    const imageBytes = await readImageBytes(request, imageRef, owner);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "otg-character-default-"));
    const inputPath = path.join(tempDir, "input.png");
    const outputTempPath = path.join(tempDir, "output.png");
    await fs.writeFile(inputPath, imageBytes);

    const rembg = await runRembg(inputPath, outputTempPath);
    if (!rembg.ok) {
      return json(200, {
        ok: true,
        backgroundRemoved: false,
        fallback: true,
        defaultCharacterImagePath: imageRef,
        defaultCharacterPreviewImagePath: imageRef,
        backgroundRemovedDefaultImagePath: imageRef,
        characterCardWorkflowImagePath: workflowCardRef,
        defaultCharacterImageStatus: "fallback_original_card",
        warning: "Background removal command failed or is not installed. Install rembg or set OTG_REMBG_COMMAND. Saved source image as fallback default image.",
      });
    }

    const publicDir = path.join(OTG_DATA_ROOT, "uploads", "characters", safeSegment(owner.ownerKey), "defaults");
    await fs.mkdir(publicDir, { recursive: true });
    const outputName = `${safeSlug(characterName)}-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
    const outputPath = path.join(publicDir, outputName);
    await fs.copyFile(outputTempPath, outputPath);
    const publicPath = `/api/file?path=${encodeURIComponent(outputPath)}`;

    return json(200, {
      ok: true,
      backgroundRemoved: true,
      fallback: false,
      defaultCharacterImagePath: publicPath,
      defaultCharacterPreviewImagePath: publicPath,
      backgroundRemovedDefaultImagePath: publicPath,
      characterCardWorkflowImagePath: workflowCardRef,
      defaultCharacterImageStatus: "background_removed",
    });
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("Character image preparation failed. The original image was not changed.", 500);
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
});
