import { NextRequest, NextResponse } from "next/server";
import { getGallerySourcesForRequest, renameGalleryItem, resolveGalleryItemByName } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readJsonBody(req: NextRequest): Promise<Record<string, any>> {
  try {
    const raw = await req.text();
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    // Read the body FIRST.
    const body = await readJsonBody(req);

    // Only resolve sources after the body has been consumed.
    const { sources } = await getGallerySourcesForRequest(req);

    const name = String(body?.name ?? body?.fileName ?? "").trim();
    const newName = String(body?.newName ?? body?.renameTo ?? "").trim();
    const scopeHint = String(body?.scope ?? body?.source ?? "").trim() || null;

    if (!name || !newName) {
      return NextResponse.json(
        { ok: false, error: "Missing name or newName", received: body },
        { status: 400 }
      );
    }

    const item = resolveGalleryItemByName({
      sources,
      name,
      scopeHint,
    });

    if (!item) {
      return NextResponse.json(
        { ok: false, error: "Item not found", name, scopeHint },
        { status: 404 }
      );
    }

    const result = await renameGalleryItem(item, newName);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(
      { ok: false, error: error?.message || "Rename failed" },
      { status: 500 }
    );
  }
}
