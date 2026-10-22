import { NextRequest, NextResponse } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { POST as deleteOwnedGalleryCopy } from "@/app/api/gallery/delete/route";

/** Legacy filename API: preserve compatibility, never delete shared worker files. */
export async function POST(request: NextRequest) {
  try {
    await getOwnerContext(request);
    const body = await request.json().catch(() => null);
    const filename = body?.filename;
    if (typeof filename !== "string" || !filename || /[\\/\x00]/.test(filename) || filename === "." || filename === "..") {
      return NextResponse.json({ ok: false, error: "Invalid filename." }, { status: 400 });
    }
    const target = new URL('/api/gallery/delete', request.url);
    return deleteOwnedGalleryCopy(new NextRequest(target, { method: 'POST', headers: request.headers,
      body: JSON.stringify({ name: filename, deleteOriginals: false }) }));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof SessionInvalidError ? "Unauthorized" : "Unable to delete Gallery item." }, { status: error instanceof SessionInvalidError ? 401 : 500 });
  }
}
