import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { readJsonSafe, safeJoin } from "@/lib/paths";
import { voicesProfilesRoot, voicesUserIdFromAuth } from "@/lib/voicesPaths";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
  }

  try {
    const userId = voicesUserIdFromAuth(admin.email, admin.username);
    const root = voicesProfilesRoot(userId);
    const dirs = fs.existsSync(root) ? fs.readdirSync(root) : [];

    const items: any[] = [];
    for (const d of dirs) {
      try {
        const voiceDir = safeJoin(root, d);
        const stat = fs.statSync(voiceDir);
        if (!stat.isDirectory()) continue;
        const prof = safeJoin(voiceDir, "profile.json");
        if (!fs.existsSync(prof)) continue;
        const j = readJsonSafe<any>(prof, null);
        if (!j) continue;
        items.push({
          voiceId: String(j.voiceId || d),
          displayName: String(j.displayName || d),
          status: String(j?.qwen?.status || "unknown"),
          createdAt: String(j.createdAt || new Date(stat.mtimeMs).toISOString()),
        });
      } catch {
        continue;
      }
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    // Back-compat: some clients expect `voices: [{id,name,type,description}]`.
    const voices = items.map((it) => ({
      id: it.voiceId,
      name: it.displayName,
      type: "character" as const,
      description: it.status && it.status !== "unknown" ? `Status: ${it.status}` : undefined,
    }));

    return NextResponse.json(
      { ok: true, items, voices },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
