import { NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import {
  deleteH3LoraFiles,
  h3LoraBackendRoots,
  readH3LoraCatalog,
  synchronizeH3LoraCatalog,
  writeH3LoraCatalog,
  type H3LoraCatalogEntry,
} from "@/lib/h3LoraCatalogServer";

export const dynamic = "force-dynamic";

function denied(auth: Awaited<ReturnType<typeof requireAdmin>>) {
  return auth.ok
    ? null
    : NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
}

export async function GET() {
  const auth = await requireAdmin();
  const response = denied(auth);
  if (response) return response;
  return NextResponse.json(
    { ok: true, ...readH3LoraCatalog(), backends: h3LoraBackendRoots() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  const response = denied(auth);
  if (response) return response;
  const body = await request.json().catch(() => null);
  const action = String(body?.action || "");
  try {
    if (action === "sync")
      return NextResponse.json({
        ok: true,
        ...(await synchronizeH3LoraCatalog()),
      });
    const catalog = readH3LoraCatalog();
    if (action === "settings")
      return NextResponse.json({
        ok: true,
        ...writeH3LoraCatalog(catalog.entries, Number(body?.maxSelections)),
      });
    if (action === "revoke") {
      const id = String(body?.id || "").trim();
      if (!catalog.entries.some((entry) => entry.id === id))
        return NextResponse.json(
          { ok: false, error: "H3 LoRA policy not found." },
          { status: 404 },
        );
      const entries = catalog.entries.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              enabled: false,
              approvedForH3: false,
              compatibilityStatus: "review" as const,
            }
          : entry,
      );
      return NextResponse.json({
        ok: true,
        ...writeH3LoraCatalog(entries, catalog.maxSelections),
      });
    }
    if (action === "delete-file")
      return NextResponse.json({
        ok: true,
        ...(await deleteH3LoraFiles(
          String(body?.id || "").trim(),
          body?.backends,
        )),
      });
    if (action === "upsert") {
      const entry = body?.entry as Partial<H3LoraCatalogEntry> | null;
      const id = String(entry?.id || "").trim();
      if (!id)
        return NextResponse.json(
          { ok: false, error: "H3 LoRA id is required." },
          { status: 400 },
        );
      const existing = catalog.entries.find((item) => item.id === id);
      if (!existing)
        return NextResponse.json(
          {
            ok: false,
            error: "Sync Backends before configuring this H3 LoRA.",
          },
          { status: 404 },
        );
      const next = {
        ...existing,
        ...(entry || {}),
        id: existing.id,
        filename: existing.filename,
        discoveredOn: existing.discoveredOn,
        missingOn: existing.missingOn,
      } as H3LoraCatalogEntry;
      return NextResponse.json({
        ok: true,
        ...writeH3LoraCatalog(
          [...catalog.entries.filter((item) => item.id !== id), next],
          catalog.maxSelections,
        ),
      });
    }
    return NextResponse.json(
      { ok: false, error: "Unknown H3 LoRA admin action." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
