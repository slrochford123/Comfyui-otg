import { NextResponse } from "next/server";
import { getWorkflowList } from "@/lib/workflows";

export const runtime = "nodejs";

export async function GET() {
  const lst = getWorkflowList();
  if (!lst.ok) {
    return NextResponse.json(
      { ok: false, error: lst.error },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  const workflows = lst.list.map((w) => ({
    id: w.id,
    label: w.label ?? w.id,
    description: w.description ?? "",
    img2img: !!w.img2img,
    format: w.format,
    canRun: !!(w as any).canRun,
    needsImages: Number((w as any).needsImages || 0),
    parseOk: !!w.parseOk,
    exists: !!w.exists,
    file: w.file,
    error: w.error ?? "",
  }));

  return NextResponse.json({ ok: true, workflows }, { headers: { "cache-control": "no-store" } });
}
