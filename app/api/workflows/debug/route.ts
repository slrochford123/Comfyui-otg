import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getWorkflowsRoot, getWorkflowsIndexPath } from "@/lib/workflows";

export const runtime = "nodejs";

export async function GET() {
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
    { ok: true, root, existsRoot, indexPath, existsIndex, presetsPath, existsPresets, presetsCount },
    { headers: { "cache-control": "no-store" } },
  );
}
