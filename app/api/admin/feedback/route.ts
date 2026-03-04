import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

import { requireAdmin } from "../_requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getDataRoot() {
  return (process.env.OTG_DATA_DIR && process.env.OTG_DATA_DIR.trim()) || path.join(process.cwd(), "data");
}

type FeedbackRecord = {
  createdAt: string;
  category?: string;
  page?: string;
  message: string;
};

function safeParseLine(line: string): FeedbackRecord | null {
  const s = line.trim();
  if (!s) return null;
  try {
    const j: any = JSON.parse(s);
    const createdAt = typeof j?.createdAt === "string" ? j.createdAt : "";
    const message = typeof j?.message === "string" ? j.message : "";
    if (!message) return null;
    return {
      createdAt: createdAt || new Date(0).toISOString(),
      category: typeof j?.category === "string" ? j.category : undefined,
      page: typeof j?.page === "string" ? j.page : undefined,
      message,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  try {
    const dir = path.join(getDataRoot(), "feedback");
    let entries: string[] = [];
    try {
      const d = await fs.readdir(dir);
      entries = d.filter((x) => x.endsWith(".jsonl"));
    } catch {
      return NextResponse.json({ ok: true, count: 0, items: [] });
    }

    // Newest files first (feedback-YYYY-MM.jsonl)
    entries.sort((a, b) => b.localeCompare(a));

    const out: FeedbackRecord[] = [];
    for (const file of entries) {
      const full = path.join(dir, file);
      const txt = await fs.readFile(full, "utf8").catch(() => "");
      if (!txt) continue;
      const lines = txt.split(/\r?\n/);
      for (let i = lines.length - 1; i >= 0; i--) {
        const rec = safeParseLine(lines[i]);
        if (rec) out.push(rec);
        if (out.length >= 200) break;
      }
      if (out.length >= 200) break;
    }

    out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return NextResponse.json({ ok: true, count: out.length, items: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e || "Unknown error") }, { status: 500 });
  }
}
