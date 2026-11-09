import fs from "node:fs";
import sharp from "sharp";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { RequestError } from "@/lib/requestError";
import { receiveMediaUpload } from "@/lib/streamingUpload";
import { resolveFfprobePath, runCmd } from "@/lib/ffmpeg";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { limitedJson } from "@/lib/limitedRequestBody";
import {
  getGallerySourcesForRequest,
  resolveGalleryItemByName,
  safeGalleryName,
  writeMetaForFile,
} from "@/lib/gallery";
import { requireStorageHeadroom } from "@/lib/storageAdmission";
import {
  addEditorMedia,
  listEditorMedia,
  editorMedia,
  editorMediaFile,
  editorProject,
  editorRoot,
  requireTimelineEditor,
  type EditorMedia,
} from "@/lib/timelineEditor/store";
import { editorFailure, requireEditorOrigin } from "@/lib/timelineEditor/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store" };
const maxBytes = 750 * 1024 * 1024;
async function register(
  owner: string,
  projectId: string,
  file: string,
  name: string,
  exported: boolean,
  move = false,
) {
  editorProject(owner, projectId);
  const size = fs.statSync(file).size;
  if (!size || size > maxBytes)
    throw new RequestError("Choose media up to 750 MB.", 413);
  const image = /\.(png|jpe?g|webp|gif)$/i.test(name);
  const imageInfo = image
    ? await sharp(file, { limitInputPixels: 50_000_000 }).metadata()
    : null;
  if (image && size > 25 * 1024 * 1024)
    throw new RequestError("Choose images up to 25 MB.", 413);
  const inspected = image
    ? { code: 0, stdout: "{}" }
    : await runCmd(
        resolveFfprobePath(),
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          "mov,matroska,webm,wav,mp3,flac,ogg,aac",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          file,
        ],
        { timeoutMs: 15000 },
      );
  if (inspected.code !== 0)
    throw new RequestError("The uploaded media could not be decoded.", 400);
  const data = JSON.parse(inspected.stdout),
    video = data.streams?.find(
      (s: { codec_type: string }) => s.codec_type === "video",
    );
  const audio = data.streams?.find(
    (s: { codec_type: string }) => s.codec_type === "audio",
  );
  const duration = image
    ? 5
    : Number(data.format?.duration || video?.duration || audio?.duration);
  if (
    (!image && !video && !audio) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 3600
  )
    throw new RequestError(
      "Choose a playable audio or video file up to one hour.",
      400,
    );
  if (exported && !video)
    throw new RequestError("A video export is required.", 400);
  const extension = path.extname(name).toLowerCase();
  if (
    !/^\.(mp4|webm|mov|mkv|wav|mp3|flac|ogg|m4a|aac|png|jpg|jpeg|webp|gif)$/.test(
      extension,
    )
  )
    throw new RequestError("Unsupported media format.", 400);
  const record: EditorMedia = {
    id: randomUUID(),
    projectId,
    name: path.basename(name).slice(0, 180),
    kind: image ? "image" : video ? "video" : "audio",
    extension,
    duration,
    width: Number(imageInfo?.width || video?.width) || 0,
    height: Number(imageInfo?.height || video?.height) || 0,
    size,
    exported,
  };
  const destination = editorMediaFile(owner, record);
  requireStorageHeadroom(destination, size);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  if (move) fs.renameSync(file, destination);
  else fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o600);
  return addEditorMedia(owner, record);
}
export async function GET(request: NextRequest) {
  try {
    requireTimelineEditor();
    const { ownerKey } = await requireSessionUser(request);
    const projectId = request.nextUrl.searchParams.get("projectId");
    if (projectId) {
      editorProject(ownerKey, projectId);
      return NextResponse.json(
        { ok: true, media: listEditorMedia(ownerKey, projectId) },
        { headers },
      );
    }
    const media = editorMedia(ownerKey, request.nextUrl.searchParams.get("id"));
    return mediaFileResponse(request, editorMediaFile(ownerKey, media), {
      fileName: media.name,
      download: request.nextUrl.searchParams.get("download") === "1",
      cacheControl: "private, no-store",
    });
  } catch (error) {
    return editorFailure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    requireTimelineEditor();
    const { ownerKey } = await requireSessionUser(request);
    requireEditorOrigin(request);
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      const upload = await receiveMediaUpload(
        request,
        path.join(editorRoot(ownerKey), "uploads"),
        maxBytes,
        { images: true },
      );
      try {
        const media = await register(
          ownerKey,
          upload.fields.session,
          upload.file,
          upload.filename,
          request.nextUrl.searchParams.get("export") === "1",
          true,
        );
        return NextResponse.json({ ok: true, media }, { headers });
      } finally {
        await upload.cleanup();
      }
    }
    const body = await limitedJson(request, 8192);
    const { sources } = await getGallerySourcesForRequest(request);
    if (body.action === "import-gallery") {
      const source = resolveGalleryItemByName({
        sources,
        name: String(body.name),
        scopeHint: String(body.scope),
      });
      if (!source || source.kind !== "video")
        throw new RequestError("Choose a video from your OTG Gallery.", 404);
      const media = await register(
        ownerKey,
        String(body.projectId),
        source.path,
        path.basename(source.path),
        false,
      );
      return NextResponse.json({ ok: true, media }, { headers });
    }
    if (body.action === "save-gallery") {
      const media = editorMedia(ownerKey, body.id);
      if (!media.exported || media.kind !== "video")
        throw new RequestError("Choose a finished editor export.", 400);
      const source = sources[0],
        fileName = `timeline_${media.id}${media.extension}`,
        destination = path.join(source.dir, fileName);
      fs.mkdirSync(source.dir, { recursive: true });
      try {
        fs.copyFileSync(
          editorMediaFile(ownerKey, media),
          destination,
          fs.constants.COPYFILE_EXCL,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const title = safeGalleryName(String(body.title || "Timeline edit"));
      writeMetaForFile(
        destination,
        {
          renamedName: title + media.extension,
          sourceType: "timeline-editor-sequence",
          mediaCategory: "edited-video",
          workflowTitle: "Timeline Editor · Sequence",
          ownerKey,
          updatedAt: Date.now(),
        },
        source,
      );
      return NextResponse.json(
        {
          ok: true,
          url: `/api/gallery/file?name=${encodeURIComponent(fileName)}&scope=${source.scope}`,
          fileName,
        },
        { headers },
      );
    }
    throw new RequestError("Choose a supported media action.", 400);
  } catch (error) {
    return editorFailure(error);
  }
}
