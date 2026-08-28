import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeExt(name: string) {
  const ext = path.extname(name || "").toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return ext;
  return ".png";
}

export async function POST(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing image file" }, { status: 400 });
    }

    const outDir = path.join(OTG_DATA_ROOT, "uploads", "characters", safeSegment(ownerKey));
    ensureDir(outDir);

    const ext = safeExt(file.name);
    const id = crypto.randomUUID();
    const filename = `character_${id}${ext}`;
    const abs = path.join(outDir, filename);

    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(abs, buf);

    return NextResponse.json({
      ok: true,
      serverPath: abs,
      filename,
      fileUrl: `/api/file?path=${encodeURIComponent(abs)}`,
    });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
