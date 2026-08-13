import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

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

function possibleFetchUrls(request: NextRequest, imageRef: string) {
  const urls: string[] = [];
  const origin = request.nextUrl.origin;
  const comfyUrl = (
    process.env.COMFYUI_URL ||
    process.env.COMFY_URL ||
    process.env.NEXT_PUBLIC_COMFYUI_URL ||
    process.env.NEXT_PUBLIC_COMFY_URL ||
    ""
  ).replace(/\/+$/, "");

  if (/^https?:\/\//i.test(imageRef)) {
    urls.push(imageRef);
    return urls;
  }

  if (imageRef.startsWith("/")) {
    urls.push(`${origin}${imageRef}`);
    if (comfyUrl && imageRef.startsWith("/view")) urls.push(`${comfyUrl}${imageRef}`);
    return urls;
  }

  if (imageRef.includes("?filename=") || imageRef.includes("&filename=")) {
    urls.push(`${origin}/${imageRef.replace(/^\/+/, "")}`);
    if (comfyUrl) urls.push(`${comfyUrl}/${imageRef.replace(/^\/+/, "")}`);
    return urls;
  }

  const filename = imageRef.split(/[\\/]/).pop() || imageRef;
  if (filename) {
    urls.push(`${origin}/api/comfy/view?filename=${encodeURIComponent(filename)}&type=output`);
    urls.push(`${origin}/api/comfy/view?filename=${encodeURIComponent(filename)}&type=input`);
    if (comfyUrl) {
      urls.push(`${comfyUrl}/view?filename=${encodeURIComponent(filename)}&type=output`);
      urls.push(`${comfyUrl}/view?filename=${encodeURIComponent(filename)}&type=input`);
    }
  }

  return urls;
}

async function readImageBytes(request: NextRequest, imageRef: string) {
  if (!imageRef) throw new Error("imageRef is required.");

  if (imageRef.startsWith("data:image/")) {
    const comma = imageRef.indexOf(",");
    if (comma < 0) throw new Error("Invalid data image.");
    return Buffer.from(imageRef.slice(comma + 1), "base64");
  }

  const localPath = imageRef.replace(/^file:\/\//i, "");
  if (/^[A-Za-z]:[\\/]/.test(localPath) || localPath.startsWith("\\\\") || localPath.startsWith("/mnt/")) {
    return fs.readFile(localPath);
  }

  const urls = possibleFetchUrls(request, imageRef);
  const errors: string[] = [];

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        errors.push(`${url} -> HTTP ${response.status}`);
        continue;
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("image")) {
        errors.push(`${url} -> non-image ${contentType || "unknown"}`);
        continue;
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Could not fetch character image. Tried: ${errors.join("; ")}`);
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

    const child = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      resolve({ ok: false, stdout, stderr: stderr + String(error?.message || error) });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

export async function POST(request: NextRequest) {
  let tempDir = "";

  try {
    const body = (await request.json().catch(() => ({}))) as unknown;
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

    const imageBytes = await readImageBytes(request, imageRef);
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
        stderr: rembg.stderr.slice(0, 2000),
      });
    }

    const publicDir = path.join(process.cwd(), "public", "character-defaults");
    await fs.mkdir(publicDir, { recursive: true });
    const outputName = `${safeSlug(characterName)}-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
    const outputPath = path.join(publicDir, outputName);
    await fs.copyFile(outputTempPath, outputPath);
    const publicPath = `/character-defaults/${outputName}`;

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
    return json(200, {
      ok: true,
      backgroundRemoved: false,
      fallback: true,
      defaultCharacterImagePath: "",
      defaultCharacterPreviewImagePath: "",
      backgroundRemovedDefaultImagePath: "",
      defaultCharacterImageStatus: "fallback_original_card",
      warning: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
