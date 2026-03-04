import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { probeDurationSeconds } from "@/lib/ffmpeg";
import { safeJoin } from "@/lib/paths";
import { voicesUserIdFromAuth, voicesExtractionsRoot } from "@/lib/voicesPaths";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
  }

  try {
    const userId = voicesUserIdFromAuth(admin.email, admin.username);
    const root = voicesExtractionsRoot(userId);
    const dirs = fs.existsSync(root) ? fs.readdirSync(root) : [];

    const items: any[] = [];
    for (const d of dirs) {
      const exDir = safeJoin(root, d);
      try {
        const stat = fs.statSync(exDir);
        if (!stat.isDirectory()) continue;
        const wav = safeJoin(exDir, "audio_24k_mono.wav");
        if (!fs.existsSync(wav)) continue;
        const dur = (await probeDurationSeconds(wav)) ?? 0;

        // Pick the first video-like file for display
        const names = fs.readdirSync(exDir);
        const vid = names.find((x) => /\.(mp4|mov|webm)$/i.test(x)) || "";

        const rel = path.posix.join("users", userId, "extractions", d, "audio_24k_mono.wav");
        items.push({
          extractId: d,
          createdAt: new Date(stat.mtimeMs).toISOString(),
          videoName: vid || "(video)",
          durationSec: dur,
          audioRel: rel,
          audioUrl: `/api/voices/file?rel=${encodeURIComponent(rel)}`,
        });
      } catch {
        continue;
      }
    }

    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return NextResponse.json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
