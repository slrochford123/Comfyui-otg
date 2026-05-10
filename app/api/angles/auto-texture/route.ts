import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_ROOT = process.cwd();

function getBlenderExe() {
  return (
    process.env.BLENDER_EXE ||
    "C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe"
  );
}

function runBlender(inputGlb: string, outputGlb: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const blenderExe = getBlenderExe();
    const scriptPath = path.join(REPO_ROOT, "tools", "angles", "auto_texture.py");

    const args = [
      "--background",
      "--python",
      scriptPath,
      "--",
      inputGlb,
      outputGlb,
    ];

    const child = spawn(blenderExe, args, {
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Blender failed with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
          )
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const inputGlb = String(body.inputGlb || "");
    const jobId = String(body.jobId || `angles-${Date.now()}`);

    if (!inputGlb.toLowerCase().endsWith(".glb")) {
      return NextResponse.json(
        { ok: false, error: "inputGlb must be a .glb path" },
        { status: 400 }
      );
    }

    await fs.access(inputGlb);

    const publicDir = path.join(REPO_ROOT, "public", "angles3d", jobId);
    await fs.mkdir(publicDir, { recursive: true });

    const outputGlb = path.join(publicDir, "textured.glb");

    await runBlender(inputGlb, outputGlb);

    return NextResponse.json({
      ok: true,
      jobId,
      inputGlb,
      outputGlb,
      modelUrl: `/angles3d/${jobId}/textured.glb`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}