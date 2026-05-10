import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import { execFile } from "node:child_process";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type MeshPreviewMeta = {
  jobId: string;
  promptId: string;
  deviceId: string;
  ownerKey: string;
  endpoint: string;
  meshPath: string;
  sourceImagePath: string;
  sourceImageName: string;
  texturedModelPath: string | null;
  textureImagePath: string | null;
  multiViewUploadId: string | null;
  multiViewDir: string | null;
  multiViewStatus: string | null;
  multiViewError: string | null;
  createdAt: string;
  updatedAt: string;
};

type MultiViewManifest = {
  uploadId: string;
  deviceId: string;
  ownerKey: string;
  status: "processing" | "ready" | "partial" | "failed";
  files: Record<string, string>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_BLENDER_TIMEOUT_MS = 180_000;
const DEFAULT_TEXTURE_SIZE = 2048;
const DEFAULT_BAKE_MARGIN = 16;

function safeDeviceId(raw: string | null) {
  const v = (raw || "").toString().trim();
  const cleaned = v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return cleaned || "local";
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function runBlender(blenderExe: string, scriptPath: string, args: string[], timeoutMs: number) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      blenderExe,
      ["--background", "--python", scriptPath, "--", ...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 * 12 },
      (err, stdout, stderr) => {
        if (err && (err as any).killed) {
          return reject(new Error(`Blender texture job timed out after ${timeoutMs}ms`));
        }
        const code = (err as any)?.code ?? 0;
        resolve({ code: typeof code === "number" ? code : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
      }
    );
    child.on("error", reject);
  });
}

function existingPath(value: string | null | undefined) {
  const p = String(value || "").trim();
  return p && fssync.existsSync(p) ? p : "";
}

export async function POST(req: NextRequest) {
  let owner;
  try {
    owner = await getOwnerContext(req);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }

  try {
    const body = await req.json().catch(() => null);
    const jobId = String(body?.jobId || "").trim();
    if (!jobId) {
      return NextResponse.json({ ok: false, error: "Missing jobId" }, { status: 400 });
    }

    const deviceId = safeDeviceId(req.headers.get("x-otg-device-id") || owner.deviceId || null);
    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const previewDir = path.join(dataRoot, "tmp", "angles_preview", deviceId);
    const metaPath = path.join(previewDir, `${jobId}.meta.json`);
    const meta = await readJsonFile<MeshPreviewMeta>(metaPath);
    if (!meta) {
      return NextResponse.json({ ok: false, error: "Mesh metadata not found. Generate the mesh again first." }, { status: 404 });
    }
    if (meta.deviceId !== deviceId) {
      return NextResponse.json({ ok: false, error: "Mesh job belongs to a different device." }, { status: 403 });
    }
    if (!fssync.existsSync(meta.meshPath)) {
      return NextResponse.json({ ok: false, error: "Mesh GLB is missing on disk. Generate the mesh again first." }, { status: 404 });
    }
    if (!fssync.existsSync(meta.sourceImagePath)) {
      return NextResponse.json({ ok: false, error: "Source image is missing on disk. Generate the mesh again first." }, { status: 404 });
    }

    const blenderExe = String(process.env.OTG_BLENDER_EXE || "").trim();
    if (!blenderExe) {
      return NextResponse.json(
        { ok: false, error: "OTG_BLENDER_EXE is not set. Point it to Blender on the main PC before using Send to Blender." },
        { status: 500 }
      );
    }
    if (!fssync.existsSync(blenderExe)) {
      return NextResponse.json({ ok: false, error: `Blender executable not found: ${blenderExe}` }, { status: 500 });
    }

    const scriptPath = path.resolve(String(process.env.OTG_BLENDER_SCRIPT || path.join(process.cwd(), "scripts", "otg_texture_mesh.py")));
    if (!fssync.existsSync(scriptPath)) {
      return NextResponse.json({ ok: false, error: `Blender worker script not found: ${scriptPath}` }, { status: 500 });
    }

    const timeoutMs = Math.max(30_000, Number(process.env.OTG_BLENDER_TIMEOUT_MS || DEFAULT_BLENDER_TIMEOUT_MS));
    const textureSize = Math.max(512, Math.min(8192, Number(process.env.OTG_BLENDER_TEXTURE_SIZE || DEFAULT_TEXTURE_SIZE)));
    const bakeMargin = Math.max(0, Math.min(128, Number(process.env.OTG_BLENDER_BAKE_MARGIN || DEFAULT_BAKE_MARGIN)));

    const texturedModelPath = path.join(previewDir, `${jobId}__textured.glb`);
    const textureImagePath = path.join(previewDir, `${jobId}__texture.png`);

    await fs.unlink(texturedModelPath).catch(() => void 0);
    await fs.unlink(textureImagePath).catch(() => void 0);

    const multiViewManifestPath = meta.multiViewDir ? path.join(meta.multiViewDir, "manifest.json") : "";
    const multiViewManifest = multiViewManifestPath ? await readJsonFile<MultiViewManifest>(multiViewManifestPath) : null;
    const multiViewFiles = multiViewManifest?.files || {};

    const blenderArgs = [
      "--input-glb", meta.meshPath,
      "--input-image", meta.sourceImagePath,
      "--output-glb", texturedModelPath,
      "--output-texture", textureImagePath,
      "--texture-size", String(textureSize),
      "--bake-margin", String(bakeMargin),
    ];

    const optionalViews: Array<[string, string]> = [
      ["--front-view", existingPath(multiViewFiles.front_view)],
      ["--front-right-45", existingPath(multiViewFiles.front_right_45)],
      ["--right-90", existingPath(multiViewFiles.right_90)],
      ["--back-right-135", existingPath(multiViewFiles.back_right_135)],
      ["--back-view", existingPath(multiViewFiles.back_view)],
      ["--back-left-135", existingPath(multiViewFiles.back_left_135)],
      ["--left-90", existingPath(multiViewFiles.left_90)],
      ["--front-left-45", existingPath(multiViewFiles.front_left_45)],
    ];
    const usedViews: string[] = [];
    for (const [flag, filePath] of optionalViews) {
      if (!filePath) continue;
      blenderArgs.push(flag, filePath);
      usedViews.push(flag.replace(/^--/, ""));
    }

    const result = await runBlender(
      blenderExe,
      scriptPath,
      blenderArgs,
      timeoutMs,
    );

    if (!fssync.existsSync(texturedModelPath)) {
      const detail = `${result.stderr || result.stdout || "Blender did not create the textured GLB."}`.slice(0, 4000);
      return NextResponse.json({ ok: false, error: "Blender did not return a textured GLB.", detail }, { status: 500 });
    }

    const nowIso = new Date().toISOString();
    const nextMeta: MeshPreviewMeta = {
      ...meta,
      texturedModelPath,
      textureImagePath: fssync.existsSync(textureImagePath) ? textureImagePath : null,
      multiViewStatus: multiViewManifest?.status || meta.multiViewStatus || null,
      multiViewError: multiViewManifest?.error || meta.multiViewError || null,
      updatedAt: nowIso,
    };
    await fs.writeFile(metaPath, JSON.stringify(nextMeta, null, 2), "utf8");

    return NextResponse.json(
      {
        ok: true,
        jobId,
        texturedModelUrl: `/api/file?path=${encodeURIComponent(texturedModelPath)}`,
        textureImageUrl: nextMeta.textureImagePath ? `/api/file?path=${encodeURIComponent(nextMeta.textureImagePath)}` : null,
        detail: (result.stderr || result.stdout || "").slice(0, 2000),
        multiViewStatus: multiViewManifest?.status || null,
        multiViewUsed: usedViews,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
