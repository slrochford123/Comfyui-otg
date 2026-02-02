import fs from "node:fs";
import path from "node:path";

/**
 * GET /api/gallery/file?deviceId=...&name=...
 *
 * NOTE:
 *  - <img> tag requests cannot send custom headers.
 *  - So this endpoint MUST accept deviceId via querystring.
 *  - We still accept x-otg-device-id as a fallback.
 */

function getMime(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function safeBasename(name: string) {
  // Prevent directory traversal; only allow a simple file name.
  // e.g. "../../secret" => "secret"
  return path.basename(name);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // deviceId may come from query OR header.
    const headerDeviceId = req.headers.get("x-otg-device-id") || "";
    const deviceId = (url.searchParams.get("deviceId") || headerDeviceId).trim();

    // filename may be passed as name / filename.
    const rawName = (url.searchParams.get("name") || url.searchParams.get("filename") || "").trim();
    const name = safeBasename(rawName);

    if (!deviceId) {
      return Response.json({ ok: false, error: "Missing deviceId" }, { status: 400 });
    }
    if (!name) {
      return Response.json({ ok: false, error: "Missing name" }, { status: 400 });
    }

    // Default storage layout: ./data/<deviceId>/gallery/<filename>
    const root = path.join(process.cwd(), "data", deviceId, "gallery");
    const filePath = path.join(root, name);

    // Extra safety: ensure resolved path stays under root.
    const resolvedRoot = path.resolve(root) + path.sep;
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedRoot)) {
      return Response.json({ ok: false, error: "Invalid name" }, { status: 400 });
    }

    if (!fs.existsSync(resolvedFile)) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const stat = fs.statSync(resolvedFile);
    if (!stat.isFile()) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const buf = fs.readFileSync(resolvedFile);
    const headers = new Headers();
    headers.set("Content-Type", getMime(name));
    headers.set("Content-Length", String(buf.byteLength));
    // Allow caching thumbnails a bit; the filename usually changes per output.
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(buf, { status: 200, headers });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
