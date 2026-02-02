import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { getOwnerDirs } from "@/lib/paths";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const consume = req.nextUrl.searchParams.get("consume") === "1";

    const { otgDataDir } = getOwnerDirs(owner.ownerKey);
    const inboxDir = path.join(otgDataDir, "studio_inbox", owner.ownerKey);
    const pendingPath = path.join(inboxDir, "pending.json");

    if (!fs.existsSync(pendingPath)) {
      return NextResponse.json({ ok: true, pending: null });
    }

    const pending = JSON.parse(fs.readFileSync(pendingPath, "utf-8"));
    if (consume) {
      try { fs.unlinkSync(pendingPath); } catch {}
    }

    return NextResponse.json({ ok: true, pending });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "session" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
