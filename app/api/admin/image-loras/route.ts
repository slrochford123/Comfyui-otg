import { NextResponse } from "next/server";

import { requireAdmin } from "../_requireAdmin";
import {
  readImageLoraCatalog,
  synchronizeImageLoraCatalog,
  writeImageLoraCatalog,
  type ImageLoraCatalogEntry,
} from "@/lib/imageLoraCatalogServer";

export const dynamic = "force-dynamic";

function denied(auth: Awaited<ReturnType<typeof requireAdmin>>) {
  if (auth.ok) return null;
  return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
}

export async function GET() {
  const auth = await requireAdmin();
  const response = denied(auth);
  if (response) return response;
  return NextResponse.json({ ok: true, ...readImageLoraCatalog() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  const response = denied(auth);
  if (response) return response;
  const body = await request.json().catch(() => null);
  const action = String(body?.action || "");

  if (action === "sync") {
    try {
      return NextResponse.json({ ok: true, ...(await synchronizeImageLoraCatalog()) });
    } catch (error: any) {
      return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 503 });
    }
  }

  const catalog = readImageLoraCatalog();
  if (action === "delete") {
    const name = String(body?.name || "").trim().toLowerCase();
    if (!name) return NextResponse.json({ ok: false, error: "LoRA filename is required." }, { status: 400 });
    return NextResponse.json({ ok: true, ...writeImageLoraCatalog(catalog.entries.filter((entry) => entry.name.toLowerCase() !== name)) });
  }

  if (action === "upsert") {
    const entry = body?.entry as Partial<ImageLoraCatalogEntry> | null;
    const name = String(entry?.name || "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "LoRA filename is required." }, { status: 400 });
    const existing = catalog.entries.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const next = { ...(existing || {}), ...(entry || {}), name } as ImageLoraCatalogEntry;
    const entries = catalog.entries.filter((item) => item.name.toLowerCase() !== name.toLowerCase());
    entries.push(next);
    return NextResponse.json({ ok: true, ...writeImageLoraCatalog(entries) });
  }

  return NextResponse.json({ ok: false, error: "Unknown LoRA admin action." }, { status: 400 });
}
