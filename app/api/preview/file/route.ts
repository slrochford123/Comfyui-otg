import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { getOwnerContext } from "@/lib/ownerKey";
import { getOwnerDirs, safeJoin } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const owner = await getOwnerContext(req as any);
  const dirs = getOwnerDirs(owner.ownerKey);

  const name = req.nextUrl.searchParams.get("name") || "";
  if (!name) return NextResponse.json({ ok: false, error: "missing name" }, { status: 400 });

  const full = safeJoin(dirs.preview, name);
  if (!full || !fs.existsSync(full)) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const ext = path.extname(full).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : ext === ".mp4"
              ? "video/mp4"
              : ext === ".webm"
                ? "video/webm"
                : "application/octet-stream";

const stat = fs.statSync(full);
const size = stat.size || 0;
const range = req.headers.get("range");

if (range && mime.startsWith("video/")) {
  const m = /^bytes=(\d+)-(\d*)$/i.exec(range);
  if (m) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : Math.min(start + 1024 * 1024 - 1, size - 1);
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(full, { start, end });
    const body = Readable.toWeb(stream);
    return new NextResponse(body as any, {
      status: 206,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }
}

const buf = fs.readFileSync(full);
return new NextResponse(buf, {
  headers: {
    "Content-Type": mime,
    "Accept-Ranges": mime.startsWith("video/") ? "bytes" : "none",
    "Cache-Control": "no-store",
  },
});
}
