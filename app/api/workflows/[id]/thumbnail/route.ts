import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getWorkflowsRoot, loadWorkflowById } from "@/lib/workflows";
import { workflowFileInside } from "@/lib/workflowFileAccess";
import { withOwner, RequestError } from "@/lib/routeSecurity";

export const runtime = "nodejs";
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withOwner(async () => {
    const { id } = await context.params;
    const workflow = loadWorkflowById(id);
    if (!workflow.ok) throw new RequestError("Workflow not found.", 404);
    const relative = workflow.meta.thumbnail;
    const file = typeof relative === "string" ? workflowFileInside(getWorkflowsRoot(), relative, [".png", ".jpg", ".jpeg", ".webp"]) : null;
    if (!file) throw new RequestError("Thumbnail not found.", 404);
    const contentType = path.extname(file).toLowerCase() === ".png" ? "image/png" : path.extname(file).toLowerCase() === ".webp" ? "image/webp" : "image/jpeg";
    return new NextResponse(fs.readFileSync(file), { headers: { "Content-Type": contentType } });
  })(req);
}
