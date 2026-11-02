import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { getWorkflowsRoot } from "@/lib/workflows";
import { workflowFileInside } from "@/lib/workflowFileAccess";
import { withOwner, RequestError } from "@/lib/routeSecurity";

export const runtime = "nodejs";
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withOwner(async () => {
    const { id } = await ctx.params;
    let rawId: string;
    try { rawId = decodeURIComponent(String(id ?? "")).trim(); }
    catch { throw new RequestError("Invalid workflow identifier.", 400); }
    const name = rawId.toLowerCase().endsWith(".json") ? rawId : `${rawId}.json`;
    const candidates = rawId.startsWith("presets/") ? [name] : [name, `presets/${name}`];
    for (const relative of candidates) {
      const file = workflowFileInside(getWorkflowsRoot(), relative, [".json"]);
      if (!file) continue;
      return NextResponse.json(JSON.parse(fs.readFileSync(file, "utf8")));
    }
    throw new RequestError("Workflow not found.", 404);
  })(req);
}
