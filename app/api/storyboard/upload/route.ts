import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export const runtime = "nodejs";

function env(name: string, fallback?: string) {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function safeExt(name: string) {
  const ext = path.extname(name || "").toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return ext;
  return ".png";
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing image file" }, { status: 400 });
    }

 const root = env("OTG_DATA_DIR") ?? path.join(process.cwd(), "data");
const outDir = path.join(root, "uploads", "storyboard");
    await fs.mkdir(outDir, { recursive: true });

    const ext = safeExt(file.name);
    const id = crypto.randomUUID();
    const filename = `sb_${id}${ext}`;
    const abs = path.join(outDir, filename);

    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(abs, buf);

    return NextResponse.json({ serverPath: abs, filename });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
