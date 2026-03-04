import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type LoraItem = {
  name: string; // filename
  label: string; // display name
};

function stripExt(filename: string) {
  return filename.replace(/\.(safetensors|pt)$/i, "");
}

function isDir(p: string) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findRepoRoot(startDir: string) {
  // In production, Next's cwd can be inside .next/server.
  // Walk upward until we find a package.json.
  let cur = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(cur, "package.json");
    try {
      if (fs.existsSync(pkg) && fs.statSync(pkg).isFile()) return cur;
    } catch {
      // ignore
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

export async function GET() {
  try {
    const cwd = process.cwd();
    const repoRoot = findRepoRoot(cwd);

    const candidates: string[] = [];

    // Explicit override (recommended)
    if (process.env.COMFY_LORA_DIR) {
      candidates.push(path.resolve(process.env.COMFY_LORA_DIR));
    }

    // Prefer repo-root-relative locations (works for dev and prod)
    if (repoRoot) {
      candidates.push(path.resolve(repoRoot, "loras"));
      candidates.push(path.resolve(repoRoot, "..", "loras"));
    }

    // Fallbacks (if repo root not found)
    candidates.push(path.resolve(cwd, "loras"));
    candidates.push(path.resolve(cwd, "..", "loras"));

    const loraDir = candidates.find(isDir);

    if (!loraDir) {
      return NextResponse.json(
        {
          ok: true,
          items: [] as LoraItem[],
          error:
            "No LoRA directory found. Set COMFY_LORA_DIR in .env.local or create ./loras in the project root.",
          debug: { cwd, repoRoot, candidates },
        },
        { headers: { "cache-control": "no-store" } }
      );
    }

    const items: LoraItem[] = fs
      .readdirSync(loraDir)
      .filter((f) => /\.(safetensors|pt)$/i.test(f))
      .sort((a, b) => a.localeCompare(b))
      .map((f) => ({ name: f, label: stripExt(f) }));

    return NextResponse.json(
      { ok: true, items, dir: loraDir, debug: { cwd, repoRoot, candidates } },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, items: [], error: String(err?.message ?? err) },
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  }
}
