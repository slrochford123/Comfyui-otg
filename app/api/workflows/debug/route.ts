import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getWorkflowsRoot, getWorkflowsIndexPath } from "@/lib/workflows";
import { requireAdmin } from "@/app/api/admin/_requireAdmin";

export const runtime = "nodejs";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  const root = getWorkflowsRoot();
  const indexPath = getWorkflowsIndexPath();
  const existsRoot = fs.existsSync(root);
  const existsIndex = fs.existsSync(indexPath);
  const presetsPath = path.join(root, "presets");
  const existsPresets = fs.existsSync(presetsPath);
  let presetsCount = 0;
  try {
    presetsCount = existsPresets ? fs.readdirSync(presetsPath).filter((n) => n.toLowerCase().endsWith(".json")).length : 0;
  } catch {}
  return NextResponse.json(
    { ok: true, existsRoot, existsIndex, existsPresets, presetsCount },
    { headers: { "cache-control": "no-store" } },
  );
}
