import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getWorkflowsRoot, loadWorkflowById } from "@/lib/workflows";

export const runtime = "nodejs";

function contentTypeFor(p: string) {
  const ext = p.toLowerCase();
  if (ext.endsWith(".png")) return "image/png";
  if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) return "image/jpeg";
  if (ext.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const wf = loadWorkflowById(id);
  if (!wf.ok) return NextResponse.json({ error: wf.error }, { status: wf.status });

  const thumbRel = (wf.meta as any).thumbnail;
  if (!thumbRel || typeof thumbRel !== "string") {
    return NextResponse.json({ error: "thumbnail not set" }, { status: 404 });
  }

  const root = getWorkflowsRoot();
  const filePath = path.join(root, thumbRel);
  if (!fs.existsSync(filePath)) return NextResponse.json({ error: "thumbnail missing" }, { status: 404 });

  const buf = fs.readFileSync(filePath);
  return new NextResponse(buf, { status: 200, headers: { "Content-Type": contentTypeFor(filePath), "Cache-Control": "no-store" } });
}
