import { NextRequest, NextResponse } from "next/server";
import path from "node:path";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { getVoiceById, upsertVoice, voicesSamplesDir, type VoiceStudioEntry } from "@/lib/voicesStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_MIME = new Set<string>([
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
  "audio/x-flac",
  "audio/mp4", // m4a
  "audio/aac",
  "audio/ogg",

  // Video containers (we extract audio via ffmpeg)
  "video/mp4",
  "video/quicktime",
]);

function maxUploadBytes(): number {
  const mb = Number(process.env.VOICES_MAX_UPLOAD_MB || 25);
  if (!Number.isFinite(mb) || mb <= 0) return 25 * 1024 * 1024;
  return Math.min(200, mb) * 1024 * 1024;
}

function extFromName(name: string): string {
  const e = path.extname(name || "").toLowerCase();
  if (e && e.length <= 10) return e;
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const fd = await req.formData();

    const voiceId = String(fd.get("voiceId") || "").trim();
    if (!voiceId) return NextResponse.json({ ok: false, error: "Missing voiceId" }, { status: 400 });

    const voice = getVoiceById(user.ownerKey, voiceId);
    if (!voice) return NextResponse.json({ ok: false, error: "Voice not found" }, { status: 404 });

    const file = fd.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const size = Number((file as any).size || 0);
    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ ok: false, error: "Empty file" }, { status: 400 });
    }
    if (size > maxUploadBytes()) {
      return NextResponse.json(
        { ok: false, error: `File too large (max ${Math.floor(maxUploadBytes() / (1024 * 1024))}MB)` },
        { status: 413 }
      );
    }

    const mime = String((file as any).type || "").toLowerCase();
    if (mime && !ALLOWED_MIME.has(mime)) {
      return NextResponse.json({ ok: false, error: `Unsupported audio type: ${mime}` }, { status: 415 });
    }

    const origName = String((file as any).name || "ref_upload");
    const rawExt = extFromName(origName);

    const dir = voicesSamplesDir(voiceId);
    const fs = await import("node:fs/promises");

    const isVideo = mime.startsWith("video/") || rawExt === ".mp4" || rawExt === ".mov";
    const stamp = Date.now();

    let audioAbs = "";
    let audioRel = "";
    let videoAbs: string | null = null;
    let videoRel: string | null = null;

    if (isVideo) {
      // Save original video and extract audio -> 24k mono wav for downstream voice pipelines.
      const videoName = `ref_${stamp}${rawExt || ".mp4"}`;
      videoAbs = path.join(dir, videoName);
      await fs.writeFile(videoAbs, Buffer.from(await file.arrayBuffer()));
      videoRel = path.posix.join("samples", voiceId, videoName);

      const wavName = `ref_${stamp}.wav`;
      audioAbs = path.join(dir, wavName);

      const ffmpeg = resolveFfmpegPath();
      const args = [
        "-y",
        "-i",
        videoAbs,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "24000",
        "-ac",
        "1",
        audioAbs,
      ];

      const r = await runCmd(ffmpeg, args, { timeoutMs: 3 * 60 * 1000 });
      if (r.code !== 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "Audio extraction failed",
            detail: (r.stderr || r.stdout || "ffmpeg failed").toString().slice(0, 2000),
          },
          { status: 500 }
        );
      }

      audioRel = path.posix.join("samples", voiceId, wavName);
    } else {
      // Save audio as-is.
      const ext = rawExt || (mime.includes("mpeg") ? ".mp3" : mime.includes("wav") ? ".wav" : ".audio");
      const outName = `ref_${stamp}${ext}`;
      audioAbs = path.join(dir, outName);
      await fs.writeFile(audioAbs, Buffer.from(await file.arrayBuffer()));
      audioRel = path.posix.join("samples", voiceId, outName);
    }

    const updated: VoiceStudioEntry = {
      ...voice,
      refAudioRel: audioRel,
      ...(videoRel ? { refVideoRel: videoRel } : null),
    };
    const saved = upsertVoice(user.ownerKey, updated);

    return NextResponse.json(
      {
        ok: true,
        voice: saved,
        audioRel,
        audioUrl: `/api/file?path=${encodeURIComponent(audioAbs)}`,
        ...(videoAbs && videoRel
          ? {
              videoRel,
              videoUrl: `/api/file?path=${encodeURIComponent(videoAbs)}`,
            }
          : null),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
