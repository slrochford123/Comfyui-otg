import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { authorize, studio, failure } from "@/lib/productionStudio/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ id: string; asset: string }> },
) {
  try {
    const u = await authorize(req),
      p = await c.params,
      { asset, path } = studio().asset(u.ownerKey, p.id, p.asset),
      size = fs.statSync(path).size;
    let start = 0,
      end = size - 1,
      status = 200;
    const range = req.headers.get("range");
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      if (!m[1]) start = Math.max(0, size - Number(m[2]));
      else {
        start = Number(m[1]);
        if (m[2]) end = Math.min(size - 1, Number(m[2]));
      }
      if (start > end || start >= size)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      status = 206;
    }
    const headers: Record<string, string> = {
      "Content-Type": asset.mime,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    if (status === 206)
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    if (req.nextUrl.searchParams.has("download"))
      headers["Content-Disposition"] =
        `attachment; filename*=UTF-8''${encodeURIComponent(asset.name.replace(/[\r\n]/g, ""))}`;
    return new Response(
      Readable.toWeb(
        fs.createReadStream(path, { start, end }),
      ) as ReadableStream,
      { status, headers },
    );
  } catch (e) {
    return failure(e);
  }
}
