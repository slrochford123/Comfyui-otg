import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

type Body = { filename: string; subfolder?: string; type?: "output" | "input" | "temp" | string };

function safeJoin(base: string, ...parts: string[]) {
  const p = path.normalize(path.join(base, ...parts));
  const b = path.normalize(base + path.sep);
  if (!p.startsWith(b)) throw new Error("Path traversal blocked");
  return p;
}

export async function POST(req: Request) {
  try {
    const { filename, subfolder = "", type = "output" } = (await req.json()) as Body;

    if (!filename) return NextResponse.json({ ok: false, error: "Missing filename" }, { status: 400 });

    // Adjust these env vars to match your machine
    const comfyDir = process.env.COMFYUI_DIR || "C:\\ComfyUI";
    const base = path.join(comfyDir, String(type)); // output/input/temp

    const target = safeJoin(base, subfolder, filename);
    await fs.unlink(target);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
