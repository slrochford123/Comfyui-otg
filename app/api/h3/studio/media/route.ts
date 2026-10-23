import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { videoTrimSession } from "@/lib/h3VideoTrimSession";
import { assertH3StudioAvailable } from "@/lib/h3StudioAdmission";
import { H3_STUDIO_MEDIA_MAX_BYTES, publicStudioMedia, readStudioMedia, registerStudioMedia, removeStudioMedia, updateStudioMedia } from "@/lib/h3StudioMedia";
import { limitedFormData } from "@/lib/limitedRequestBody";
import { readH3StudioJson } from "@/lib/h3StudioRequests";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function failure(error: unknown) {
  const auth = /session|unauthorized/i.test(error instanceof Error ? error.message : "");
  return NextResponse.json({ ok: false, error: auth ? "Sign in to manage references." : "Reference unavailable or invalid. Select a supported file and prepare a new plan." }, { status: auth ? 401 : 400, headers });
}
export async function POST(request: NextRequest) {
  try {
    const scope = await videoTrimSession(request); assertH3StudioAvailable();
    const form = await limitedFormData(request, H3_STUDIO_MEDIA_MAX_BYTES + 64 * 1024);
    const files = form.getAll("file");
    if (files.length !== 1 || !(files[0] instanceof File)) throw new Error("Choose one file.");
    const asset = await registerStudioMedia(scope.owner, scope.session, files[0], {
      role: String(form.get("role") || "reference") as "first" | "last" | "reference",
      description: String(form.get("description") || ""), includeAudio: form.get("includeAudio") === "true",
      clipStartSeconds: Number(form.get("clipStartSeconds") || 0),
    }, request.signal);
    return NextResponse.json({ ok: true, asset: publicStudioMedia(asset) }, { headers });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: NextRequest) {
  try {
    const scope = await videoTrimSession(request); assertH3StudioAvailable();
    const { id, ...patch } = await readH3StudioJson(request, 4000);
    return NextResponse.json({ ok: true, asset: publicStudioMedia(await updateStudioMedia(scope.owner, scope.session, String(id || ""), patch)) }, { headers });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    const scope = await videoTrimSession(request); assertH3StudioAvailable();
    await removeStudioMedia(scope.owner, scope.session, request.nextUrl.searchParams.get("id") || "");
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) { return failure(error); }
}
export async function GET(request: NextRequest) {
  try {
    const scope = await videoTrimSession(request); assertH3StudioAvailable();
    const { asset, path } = await readStudioMedia(scope.owner, scope.session, request.nextUrl.searchParams.get("id") || "");
    let start = 0, end = asset.bytes - 1; const range = request.headers.get("range");
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match || !match[1] && !match[2]) return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${asset.bytes}` } });
      start = match[1] ? Number(match[1]) : Math.max(0, asset.bytes - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= asset.bytes) return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${asset.bytes}` } });
    }
    return new NextResponse(Readable.toWeb(fs.createReadStream(path, { start, end })) as ReadableStream, { status: range ? 206 : 200, headers: { ...headers, "Content-Type": asset.contentType, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${asset.bytes}` } : {}) } });
  } catch (error) { return failure(error); }
}
