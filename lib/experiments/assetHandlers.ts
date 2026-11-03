import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { abandonAsset, finishAsset, getAsset, getSession, MAX_ASSET_BYTES, reserveAsset, removeSavedUpload } from "@/lib/experiments/store";
import sharp from "sharp";
import { privateHeaders } from "@/lib/experiments/http";
import { assertNsfwSession } from "./apiHandlers";
import { requireNsfwAccess } from "./nsfwAccess";
import { RequestError } from "@/lib/requestError";
import { parseRange } from "@/lib/experiments/range";
import {labUploadMime,MAX_LAB_IMAGE_BYTES} from "./imageTypes";
import {labImagePaths,prepareLabImage} from "./images";

const probe = promisify(execFile);
const formats: Record<string, string[]> = {
  "image/png": ["png_pipe"], "image/jpeg": ["jpeg_pipe"], "image/webp": ["webp_pipe"],
  "video/mp4": ["mov", "mp4"], "video/webm": ["matroska", "webm"],
  "audio/wav": ["wav"], "audio/mpeg": ["mp3"], "audio/flac": ["flac"],
};
export async function assetPost(request:NextRequest, owner:string, restricted=false) {
  const session = request.nextUrl.searchParams.get("session") || "";
  if(restricted)assertNsfwSession(owner,session);
  const role = request.nextUrl.searchParams.get("role") || "source";
  const name=request.nextUrl.searchParams.get("name")||"Uploaded asset";
  const mime=labUploadMime(name,request.headers.get("content-type")||""),image=mime.startsWith("image/"),maxBytes=image?MAX_LAB_IMAGE_BYTES:MAX_ASSET_BYTES;
  if ((!image&&!formats[mime]) || !["source", "comparison"].includes(role) || !request.body) throw new RequestError("Choose an image, MP4, WebM, WAV, MP3 or FLAC file.", 415);
  if (Number(request.headers.get("content-length")) > maxBytes) throw new RequestError(image?"Images can be up to 512 MiB; resolution is prepared automatically.":"Maximum audio/video file size is 128 MiB.",413);
  const pending = reserveAsset(owner, session, name, mime, role,maxBytes);
  let bytes = 0, created = false;
  const hash = crypto.createHash("sha256");
  try {
    const fd = fs.openSync(pending.file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); created = true;
    const limit = new Transform({ transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > maxBytes) return done(new RequestError(image?"Images can be up to 512 MiB; resolution is prepared automatically.":"Maximum audio/video file size is 128 MiB.",413));
      hash.update(chunk); done(null, chunk);
    } });
    await pipeline(Readable.fromWeb(request.body as import("node:stream/web").ReadableStream), limit, fs.createWriteStream(pending.file, { fd, autoClose: true }), { signal: request.signal });
    if (!bytes) throw new RequestError("The uploaded file is empty.", 400);
    const sha256=hash.digest("hex");let detectedMime=mime;
    if(image){detectedMime=(await prepareLabImage(pending.file,sha256,request.signal)).mime;}
    else try {
      const { stdout } = await probe("/usr/bin/ffprobe", ["-v", "error", "-max_alloc", "33554432", "-protocol_whitelist", "file,pipe", "-show_entries", "format=format_name:stream=codec_type,width,height", "-of", "json", pending.file], { timeout: 15000, maxBuffer: 256 * 1024 });
      const info = JSON.parse(stdout);
      if (!formats[mime].some(format => String(info.format?.format_name).split(",").includes(format)) || !info.streams?.some((stream: { codec_type: string }) => stream.codec_type === (mime.startsWith("audio/") ? "audio" : "video"))) throw new Error("type");
    } catch { throw new RequestError("This audio/video file could not be read. Choose a valid MP4, WebM, WAV, MP3 or FLAC file.", 415); }
    if(restricted)requireNsfwAccess(owner);
    finishAsset(owner, pending.id, bytes, sha256,detectedMime);
    return NextResponse.json({ ok: true, session: getSession(owner, session) }, { status: 201 });
  } catch (error) {
    if (created)for(const file of [pending.file,...Object.values(labImagePaths(pending.file))]){try{fs.unlinkSync(file);}catch{/* only newly reserved files */}}
    abandonAsset(owner, pending.id);
    throw error;
  }
}

export async function assetServe(request:NextRequest, owner:string, restricted=false) {
  const { asset, file:original } = getAsset(owner, request.nextUrl.searchParams.get("id") || "");
  if(restricted)assertNsfwSession(owner,asset.session);
  const prepared=asset.role!=="generated"&&asset.mime.startsWith("image/")&&request.nextUrl.searchParams.get("download")!=="1"?await prepareLabImage(original,asset.sha256,request.signal):null;
  const file=prepared?.file||original;
  if (request.nextUrl.searchParams.get("thumbnail") === "1" && prepared) {
    // Decode only the bounded, validated derivative, never a huge original.
    const thumbnail = await sharp(file).resize(160,160,{fit:"inside",withoutEnlargement:true}).webp({quality:75}).toBuffer();
    return new Response(request.method === "HEAD" ? null : new Uint8Array(thumbnail), {headers:{...privateHeaders,"Content-Type":"image/webp","Content-Length":String(thumbnail.length),"Content-Security-Policy":"default-src 'none'; sandbox"}});
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let streamOwnsFd = false;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== (prepared?.bytes??asset.bytes)) throw new RequestError("Media integrity check failed.", 409);
    let range;
    try { range = parseRange(request.headers.get("range"), stat.size); }
    catch { return new Response(null, { status: 416, headers: { ...privateHeaders, "Content-Range": `bytes */${stat.size}` } }); }
    const headers = new Headers({ ...privateHeaders, "Content-Type": prepared?"image/png":asset.mime, "Accept-Ranges": "bytes", "Content-Length": String(range ? range.end - range.start + 1 : stat.size), "Content-Security-Policy": "default-src 'none'; sandbox" });
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    if (request.nextUrl.searchParams.get("download") === "1") headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`);
    if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
    const stream = fs.createReadStream(file, { fd, autoClose: true, ...(range || {}) }); streamOwnsFd = true;
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
  } finally { if (!streamOwnsFd) fs.closeSync(fd); }
}

export async function assetRemoveSaved(request:NextRequest,owner:string) {
  const id=request.nextUrl.searchParams.get("id")||"";
  const {asset}=getAsset(owner,id);
  assertNsfwSession(owner,asset.session);
  return NextResponse.json({ok:true,session:removeSavedUpload(owner,id)});
}
