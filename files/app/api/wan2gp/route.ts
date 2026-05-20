import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { markRunning } from "@/lib/contentState";
import { deviceGalleryDir, userGalleryDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OTG_DATA_DIR = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
const JOBS_DIR = path.join(OTG_DATA_DIR, "device_jobs");
const WAN2GP_JOBS_DIR = path.join(OTG_DATA_DIR, "wan2gp_jobs");
const WAN2GP_ROOT = (process.env.WAN2GP_ROOT || "C:\\AI\\Wan2GP").trim();
const WAN2GP_PYTHON = (process.env.WAN2GP_PYTHON || "C:\\Users\\SLRoc\\miniconda3\\python.exe").trim();
const WAN2GP_MODEL_TYPE = (process.env.WAN2GP_MODEL_TYPE || "i2v_2_2").trim();

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeSegment(input: string, fallback = "local") {
  const cleaned = String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return cleaned || fallback;
}

function safeFilename(input: string, fallback = "upload.png") {
  const base = path.basename(String(input || fallback)).replace(/[^a-zA-Z0-9._() -]+/g, "_");
  return base || fallback;
}

function randomJobId() {
  return `wan2gp_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

function videoLengthFromSeconds(secondsRaw: unknown) {
  const seconds = Math.max(5, Math.min(15, Math.floor(Number(secondsRaw) || 5)));
  return seconds * 24 + 1;
}

function resolutionFromInputs(orientationRaw: unknown, widthRaw: unknown, heightRaw: unknown) {
  const width = Math.floor(Number(widthRaw) || 0);
  const height = Math.floor(Number(heightRaw) || 0);
  if (width > 0 && height > 0) {
    return `${width}x${height}`;
  }

  const orientation = String(orientationRaw || "").trim().toLowerCase();
  return orientation === "portrait" ? "720x1280" : "1280x720";
}

function gpuVisibilityForTarget(targetRaw: unknown) {
  const target = String(targetRaw || "").trim().toLowerCase();
  const envJson = String(process.env.WAN2GP_GPU_MAP_JSON || "").trim();
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson) as Record<string, unknown>;
      const match = parsed?.[target];
      if (match !== undefined && match !== null) return String(match);
    } catch {
      // ignore invalid override JSON
    }
  }

  if (target === "3090") return "0";
  if (target === "5060ti") return "1";
  if (target === "3060ti") return "2";
  if (/^\d+(,\d+)*$/.test(target)) return target;
  return "";
}

function chooseOutputDir(username: string | null, deviceId: string) {
  if (username) return userGalleryDir(username);
  return deviceGalleryDir(deviceId);
}

export async function POST(req: NextRequest) {
  let ownerCtx;
  try {
    ownerCtx = await getOwnerContext(req);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }

  try {
    const workflowId = String(req.headers.get("x-otg-workflow-id") || "").trim().toLowerCase();
    const form = await req.formData();
    const formWorkflowId = String(form.get("workflowId") || workflowId || "").trim().toLowerCase();
    if (formWorkflowId !== "wan2gp-i2v") {
      return NextResponse.json({ ok: false, error: "Invalid Wan2GP workflowId" }, { status: 400 });
    }

    if (!WAN2GP_ROOT || !fs.existsSync(path.join(WAN2GP_ROOT, "wgp.py"))) {
      return NextResponse.json({ ok: false, error: `Wan2GP root is not configured correctly: ${WAN2GP_ROOT}` }, { status: 500 });
    }

    const prompt = String(form.get("prompt") || form.get("positivePrompt") || "").trim();
    const negativePrompt = String(form.get("negativePrompt") || "").trim();
    const orientation = String(form.get("orientation") || "landscape").trim().toLowerCase();
    const durationSeconds = Math.max(5, Math.min(15, Math.floor(Number(form.get("durationSeconds") || 5) || 5)));
    const gpuTarget = String(form.get("gpuTarget") || "").trim();
    const seedValue = Math.floor(Number(form.get("seed") || -1));
    const widthValue = String(form.get("width") || "").trim();
    const heightValue = String(form.get("height") || "").trim();

    const image = form.get("imageA");
    if (!image || typeof image === "string") {
      return NextResponse.json({ ok: false, error: "Wan2GP requires an input image." }, { status: 400 });
    }

    const deviceId = safeSegment(ownerCtx.deviceId || req.headers.get("x-otg-device-id") || "local", "local");
    const ownerKey = String(ownerCtx.ownerKey || deviceId);
    const username = ownerCtx.username ? String(ownerCtx.username) : null;
    const outputDir = chooseOutputDir(username, deviceId);
    const jobId = randomJobId();
    const jobDir = path.join(WAN2GP_JOBS_DIR, jobId);
    const inputDir = path.join(jobDir, "input");
    ensureDir(inputDir);
    ensureDir(outputDir);
    ensureDir(JOBS_DIR);

    const file = image as File;
    const uploadName = safeFilename(file.name || "input.png", "input.png");
    const savedImagePath = path.join(inputDir, uploadName);
    fs.writeFileSync(savedImagePath, Buffer.from(await file.arrayBuffer()));

    const resolution = resolutionFromInputs(orientation, widthValue, heightValue);
    const submitPayload = {
      preset: "wan2gp-i2v",
      workflowId: "wan2gp-i2v",
      positivePrompt: prompt,
      negativePrompt,
      durationSeconds,
      orientation,
      seed: Number.isFinite(seedValue) ? seedValue : -1,
      width: widthValue || null,
      height: heightValue || null,
      gpuTarget: gpuTarget || null,
    };

    markRunning(ownerKey, {
      title: "Wan 2.2 Image to Video",
      workflowId: "wan2gp-i2v",
      deviceId,
      positivePrompt: prompt || null,
      negativePrompt: negativePrompt || null,
      submitPayload,
    });

    const jobConfig = {
      jobId,
      ownerKey,
      username,
      deviceId,
      workflowId: "wan2gp-i2v",
      workflowTitle: "Wan 2.2 Image to Video",
      positivePrompt: prompt,
      negativePrompt,
      durationSeconds,
      videoLength: videoLengthFromSeconds(durationSeconds),
      orientation,
      resolution,
      seed: Number.isFinite(seedValue) ? seedValue : -1,
      gpuTarget,
      gpuVisibility: gpuVisibilityForTarget(gpuTarget),
      outputDir,
      jobDir,
      inputImagePath: savedImagePath,
      inputImageName: uploadName,
      wanRoot: WAN2GP_ROOT,
      wanPython: WAN2GP_PYTHON,
      modelType: WAN2GP_MODEL_TYPE,
      createdAt: Date.now(),
      submitPayload,
    };

    const jobFile = path.join(jobDir, "job.json");
    fs.writeFileSync(jobFile, JSON.stringify(jobConfig, null, 2), "utf-8");

    fs.appendFileSync(
      path.join(JOBS_DIR, `${deviceId}.jsonl`),
      JSON.stringify({
        ts: Date.now(),
        ownerKey,
        username,
        deviceId,
        title: "Wan 2.2 Image to Video",
        preset: "wan2gp-i2v",
        positivePrompt: prompt || null,
        negativePrompt: negativePrompt || null,
        seed: Number.isFinite(seedValue) ? seedValue : null,
        prompt_id: null,
        rawResponse: { ok: true, backend: "wan2gp", jobId },
        submitPayload,
      }) + "\n",
      "utf-8"
    );

    const runnerPath = path.join(process.cwd(), "scripts", "wan2gp", "run-job.mjs");
    const child = spawn(process.execPath, [runnerPath, jobFile], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        OTG_DATA_DIR,
      },
    });
    child.unref();

    return NextResponse.json({
      ok: true,
      backend: "wan2gp",
      backendLabel: "Wan2GP",
      jobId,
      workflowId: "wan2gp-i2v",
      status: "queued",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
