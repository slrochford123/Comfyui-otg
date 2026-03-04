import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { ensureDir, safeJoin, safeSegment } from "@/lib/paths";
import { voicesExtractionsRoot, voicesUserIdFromAuth } from "@/lib/voicesPaths";

function writeFileAtomicLocal(filePath: string, data: Buffer) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function nowId(prefix: string): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `${prefix}_${Date.now()}_${rnd}`;
}

/**
 * Extracts a short voice clip from an uploaded video and stores it in the per-user extractions folder.
 * Output wav is normalized to 24kHz mono for Qwen3TTS compatibility.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
  }

  try {
    const form = await req.formData();
    const file = form.get("video");
    const start = Number(form.get("start") ?? 0);
    const end = Number(form.get("end") ?? 30);

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing video file" }, { status: 400 });
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return NextResponse.json({ ok: false, error: "Invalid start/end" }, { status: 400 });
    }

    const dur = end - start;
    if (dur < 3 || dur > 120) {
      return NextResponse.json({ ok: false, error: "Clip must be 3s–120s" }, { status: 400 });
    }

    const userId = voicesUserIdFromAuth(admin.email, admin.username);
    const root = voicesExtractionsRoot(userId);
    const extractId = nowId("x");
    const exDir = safeJoin(root, safeSegment(extractId));
    ensureDir(exDir);

    const originalName = (file.name || "video.mp4").replace(/[^\w.\- ]+/g, "_");
    const inPath = safeJoin(exDir, originalName);
    const wavPath = safeJoin(exDir, "audio_24k_mono.wav");

    // Save the uploaded video
    const buf = Buffer.from(await file.arrayBuffer());
    writeFileAtomicLocal(inPath, buf);

    // ffmpeg extract -> 24k mono wav
    const ffmpeg = resolveFfmpegPath();
    const args = [
      "-y",
      "-ss",
      String(start),
      "-t",
      String(dur),
      "-i",
      inPath,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      wavPath,
    ];
    const r = await runCmd(ffmpeg, args, { timeoutMs: 3 * 60 * 1000 });
    if (r.code !== 0) {
      return NextResponse.json(
        { ok: false, error: "ffmpeg failed", detail: r.stderr || r.stdout },
        { status: 500 },
      );
    }
    if (!fs.existsSync(wavPath)) {
      return NextResponse.json({ ok: false, error: "Audio extraction failed" }, { status: 500 });
    }

    const rel = path.posix.join("users", userId, "extractions", extractId, "audio_24k_mono.wav");
    return NextResponse.json(
      {
        ok: true,
        extractId,
        // Back-compat for older clients
        audioId: extractId,
        durationSec: dur,
        audioRel: rel,
        audioUrl: `/api/voices/file?rel=${encodeURIComponent(rel)}`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Extract failed" }, { status: 500 });
  }
}
