import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getGallerySourcesForRequest, resolveGalleryItemByName } from "@/lib/gallery";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import {productionAudioMediaReadable,ProductionAudioAccessError} from "@/lib/productionAudioAccess";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";
import { resolveFfmpegPath, resolveFfprobePath, runCmd, probeDurationSeconds } from "@/lib/ffmpeg";
import { numberWithin } from "@/lib/audioEditing/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "edit_video_jobs", safeSegment(ownerKey || "local"));
}

function cleanStem(value: string, fallback: string) {
  return (String(value || fallback).replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || fallback);
}

async function saveUpload(file: File, target: string) {
  await fsp.writeFile(target, Buffer.from(await file.arrayBuffer()));
}

async function hasAudio(filePath: string) {
  const result = await runCmd(resolveFfprobePath(), ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", filePath], { timeoutMs: 30000 });
  return result.code === 0 && Boolean(result.stdout.trim());
}

async function resolveMultipartInputs(req: NextRequest, form: FormData, inputDir: string) {
  const videoSource = String(form.get("video_source") || "").trim();
  const videoFile = form.get("video_file") || form.get("video");
  let videoPath = "";
  let videoLabel = String(form.get("video_title") || "Selected video").trim() || "Selected video";
  if (videoSource === "upload") {
    if (!(videoFile instanceof File) || videoFile.size <= 0) throw new Error("Missing uploaded video.");
    videoPath = path.join(inputDir, path.basename(videoFile.name || "video.mp4"));
    await saveUpload(videoFile, videoPath);
  } else if (videoSource === "gallery") {
    const videoName = String(form.get("video_name") || "").trim();
    const scope = String(form.get("video_scope") || "").trim();
    const { sources } = await getGallerySourcesForRequest(req);
    const item = resolveGalleryItemByName({ sources, name: videoName, scopeHint: scope || null });
    if (!item || item.kind !== "video") throw new Error(`Gallery video not found: ${videoName}`);
    videoPath = item.path;
    videoLabel = item.name || videoLabel;
  }
  const musicFile = form.get("music_file") || form.get("music");
  if (!videoPath || !fs.existsSync(videoPath)) throw new Error("Choose a video first.");
  if (!(musicFile instanceof File) || musicFile.size <= 0) throw new Error("Upload an MP3, WAV, or M4A music file first.");
  const musicPath = path.join(inputDir, path.basename(musicFile.name || "music.mp3"));
  await saveUpload(musicFile, musicPath);
  return { videoPath, musicPath, videoLabel };
}

async function processMultipart(req: NextRequest) {
  const form = await req.formData();
  const { owner } = await getGallerySourcesForRequest(req);
  const jobId = randomUUID();
  const dir = path.join(jobRoot(owner.ownerKey), jobId);
  const inputDir = path.join(dir, "inputs");
  ensureDir(inputDir);
  const { videoPath, musicPath, videoLabel } = await resolveMultipartInputs(req, form, inputDir);
  const keepOriginal = String(form.get("keep_original_audio") || "0") === "1";
  const loopMusic = String(form.get("loop_music") || "0") === "1";
  const videoVolume = numberWithin(form.get("video_volume"), 1, 0, 1);
  const musicVolume = numberWithin(form.get("music_volume"), 0.25, 0, 1);
  const duration = await probeDurationSeconds(videoPath);
  if (duration === null || !(duration > 0)) throw new Error("The source video duration could not be verified.");
  const originalHasAudio = await hasAudio(videoPath);
  const outputFileName = `${cleanStem(String(form.get("title") || "video_with_music"), "video_with_music")}.mp4`;
  const outputPath = path.join(dir, outputFileName);
  const args = ["-y", "-hide_banner", "-i", videoPath];
  if (loopMusic) args.push("-stream_loop", "-1");
  args.push("-i", musicPath);
  if (keepOriginal && originalHasAudio) {
    args.push("-filter_complex", `[0:a]volume=${videoVolume}[v];[1:a]volume=${musicVolume}[m];[v][m]amix=inputs=2:duration=first:dropout_transition=2[a]`, "-map", "0:v:0", "-map", "[a]");
  } else {
    args.push("-filter_complex", `[1:a]volume=${musicVolume},apad,atrim=duration=${duration}[m]`, "-map", "0:v:0", "-map", "[m]");
  }
  args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(duration), "-movflags", "+faststart", outputPath);
  const result = await runCmd(resolveFfmpegPath(), args, { timeoutMs: 10 * 60 * 1000 });
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || "FFmpeg audio mix failed.");
  const stat = fs.statSync(outputPath);
  return NextResponse.json({ ok: true, jobId, fileName: outputFileName, url: `/api/edit-video/file?jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(outputFileName)}`, sizeBytes: stat.size, sourceVideoName: videoLabel, keepOriginalAudio: keepOriginal, loopMusic });
}

async function processLegacyJson(req: NextRequest) {
  const { video, music } = (await req.json()) as { video?: string; music?: string };
  if(typeof video!=="string"||typeof music!=="string"||!video||!music)return NextResponse.json({ok:false,error:"video and music are required."},{status:400});
  if(!await productionAudioMediaReadable(req,video)||!await productionAudioMediaReadable(req,music))throw new ProductionAudioAccessError();
  const owner=await getOwnerContext(req);const jobId=randomUUID();const dir=path.join(jobRoot(owner.ownerKey),jobId);ensureDir(dir);
  const fileName="video_with_music.mp4",output=path.join(dir,fileName);
  const duration = await probeDurationSeconds(video);
  if (duration === null || !(duration > 0)) throw new Error("The source video duration could not be verified.");
  const filter=await hasAudio(video)?`[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2,apad,atrim=duration=${duration}[a]`:`[1:a]apad,atrim=duration=${duration}[a]`;
  const result = await runCmd(resolveFfmpegPath(), ["-y", "-i", video, "-i", music, "-filter_complex", filter,"-map","0:v:0","-map","[a]", "-c:v", "copy","-c:a","aac","-t", String(duration), output], { timeoutMs: 10 * 60 * 1000 });
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || "FFmpeg failed.");
  return NextResponse.json({ ok: true, output,jobId,fileName,url:`/api/edit-video/file?jobId=${jobId}&name=${fileName}` });
}

export async function POST(req: NextRequest) {
  try {
    await requireSessionUser(req).catch(()=>{throw new SessionInvalidError();});
    const contentType = req.headers.get("content-type") || "";
    return contentType.includes("multipart/form-data") ? await processMultipart(req) : await processLegacyJson(req);
  } catch (error: any) {
    if(error instanceof ProductionAudioAccessError)return NextResponse.json({ok:false,error:error.message},{status:404});
    if (error instanceof SessionInvalidError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: error?.message || "Audio mix failed." }, { status: 500 });
  }
}
