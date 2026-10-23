import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { videoTrimSession } from "@/lib/h3VideoTrimSession";
import { cancelVideoTrim, publicVideoTrim, readVideoTrim, registerVideoTrim, trimVideoAsset, videoTrimLimits } from "@/lib/h3VideoTrim";
import { readCompletedH3StagedUpload, stagedH3UploadPaths } from "@/lib/h3StagedUploads";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Video source unavailable.";
  const auth = /session|unauthorized/i.test(message);
  const safe = /^(Select |Choose |Video |This source|Trim duration|Unsupported video)/.test(message);
  return NextResponse.json({ error: auth ? "Please sign in again." : safe ? message : "Video source unavailable. Select the video again." }, { status: auth ? 401 : 400, headers });
}
export async function POST(request: NextRequest) {
  try {
    const scope = await videoTrimSession(request);
    const body = await request.json();
    if (body.action === "trim") {
      const asset = await trimVideoAsset(scope.owner, scope.session, String(body.id || ""), body.start, body.end, request.signal);
      return NextResponse.json({ asset: publicVideoTrim(asset) }, { headers });
    }
    if (body.action !== "import") return NextResponse.json({ error: "Unsupported video action." }, { status: 400, headers });
    const upload = await readCompletedH3StagedUpload(scope.owner, body.upload, "video");
    try {
      const asset = await registerVideoTrim(scope.owner, scope.session, upload.path, upload.name);
      return NextResponse.json({ asset: publicVideoTrim(asset), limits: videoTrimLimits() }, { headers });
    } finally { await fsp.rm(stagedH3UploadPaths(scope.owner, upload).directory, { recursive: true, force: true }); }
  } catch (error) { return failure(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    const scope = await videoTrimSession(request);
    const body = await request.json();
    const source = await readVideoTrim(scope.owner, scope.session, String(body.id || ""));
    await cancelVideoTrim(scope.owner, scope.session, source.asset.id);
    if (body.remove === true) await fsp.rm(source.dir, { recursive: true, force: true });
    return NextResponse.json({ ok: true, cancelled: true }, { headers });
  } catch (error) { return failure(error); }
}
export async function GET(request: NextRequest) {
  try {
    const scope = await videoTrimSession(request);
    const { asset, path } = await readVideoTrim(scope.owner, scope.session, request.nextUrl.searchParams.get("id") || "");
    const stat = await fsp.stat(path);
    const range = request.headers.get("range");
    const match = range?.match(/^bytes=(\d*)-(\d*)$/);
    let start = 0, end = stat.size - 1;
    if (range) {
      if (!match || !match[1] && !match[2]) return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });
      start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });
    }
    const type = asset.filename.endsWith(".webm") ? "video/webm" : asset.filename.endsWith(".mov") ? "video/quicktime" : asset.filename.endsWith(".mkv") ? "video/x-matroska" : "video/mp4";
    return new NextResponse(Readable.toWeb(fs.createReadStream(path, { start, end })) as ReadableStream, { status: range ? 206 : 200, headers: { ...headers, "Content-Type": type, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}) } });
  } catch (error) { return failure(error); }
}
