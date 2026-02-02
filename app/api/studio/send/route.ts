import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { getOwnerDirs } from "@/lib/paths";

export const runtime = "nodejs";

type StudioPayload = {
  name: string; // image filename (as stored in user gallery)
  workflowId: string; // workflow id to open in Studio tab
  source?: "gallery" | "favorites";
};

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const body = (await req.json().catch(() => null)) as StudioPayload | null;

    const name = body?.name || "";
    const workflowId = body?.workflowId || "";
    const source = body?.source || "gallery";

    if (!name || !workflowId) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }

    const { otgDataDir } = getOwnerDirs(owner.ownerKey);
    const inboxDir = path.join(otgDataDir, "studio_inbox", owner.ownerKey);
    fs.mkdirSync(inboxDir, { recursive: true });

    const payload = {
      name,
      workflowId,
      source,
      ownerKey: owner.ownerKey,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(inboxDir, "pending.json"), JSON.stringify(payload, null, 2), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "session" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
