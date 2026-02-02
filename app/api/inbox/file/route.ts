import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { getOwnerDirs, safeJoin } from "@/lib/paths";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const { userInboxDir } = getOwnerDirs(owner.ownerKey);
    const name = req.nextUrl.searchParams.get("name") || "";

    if (!name) {
      return NextResponse.json({ ok: false, error: "missing_name" }, { status: 400 });
    }

    const full = safeJoin(userInboxDir, name);
    if (!full || !fs.existsSync(full)) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const ext = path.extname(name).toLowerCase();
    const contentType =
      ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";

    const data = fs.readFileSync(full);
    return new NextResponse(data, { headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "session" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
