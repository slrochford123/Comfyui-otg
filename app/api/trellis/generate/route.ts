import { NextRequest } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const WSL_DISTRO = "Ubuntu-24.04";
const WSL_REPO_DIR = "/home/slroc/trellis2-test/TRELLIS.2";
const WSL_TMP_DIR = `${WSL_REPO_DIR}/tmp`;

function toWslWindowsPath(wslPath: string): string {
  return `\\\\wsl.localhost\\${WSL_DISTRO}${wslPath.replace(/\//g, "\\")}`;
}

function runWslScript(script: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("wsl", ["bash", "-s"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      const exitCode = code ?? -1;
      if (exitCode !== 0) {
        reject(
          new Error(
            `WSL command failed with exit code ${exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
          )
        );
        return;
      }
      resolve({ stdout, stderr, code: exitCode });
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return new Response("No file uploaded", { status: 400 });
    }

    const id = Date.now().toString();
    const inputName = `input_${id}.png`;
    const outputName = `output_${id}.glb`;

    const wslInput = `${WSL_TMP_DIR}/${inputName}`;
    const wslOutput = `${WSL_TMP_DIR}/${outputName}`;

    const winTmpDir = toWslWindowsPath(WSL_TMP_DIR);
    const winInput = toWslWindowsPath(wslInput);
    const winOutput = toWslWindowsPath(wslOutput);

    fs.mkdirSync(winTmpDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(winInput, buffer);

    const bashScript = `#!/usr/bin/env bash
set -euo pipefail

mkdir -p "${WSL_TMP_DIR}"
cd "${WSL_REPO_DIR}"
source ~/trellis2-test/venv/bin/activate

python run_image_to_glb.py \
  --image "${wslInput}" \
  --model-path microsoft/TRELLIS.2-4B \
  --pipeline-type 512 \
  --max-num-tokens 16384 \
  --texture-size 1024 \
  --output "${wslOutput}"
`;

    const result = await runWslScript(bashScript);

    console.log("[TRELLIS STDOUT]\n" + result.stdout);
    if (result.stderr.trim()) {
      console.error("[TRELLIS STDERR]\n" + result.stderr);
    }

    if (!fs.existsSync(winOutput)) {
      throw new Error(`GLB not generated: ${winOutput}`);
    }

    const glb = fs.readFileSync(winOutput);

    return new Response(glb, {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Disposition": `inline; filename="${path.basename(outputName)}"`,
      },
    });
  } catch (err: any) {
    console.error("[TRELLIS ROUTE ERROR]", err);
    return new Response(
      `Trellis generation failed: ${err?.message || "unknown error"}`,
      { status: 500 }
    );
  }
}
