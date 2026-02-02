import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

function getWorkflowRoot() {
  // Must match what /api/workflows/debug reports
  return path.join(process.cwd(), "comfy_workflows");
}

function resolveInsideRoot(root: string, rel: string) {
  const safeRel = rel.replace(/\\/g, "/"); // normalize
  const full = path.resolve(root, safeRel);
  const rootResolved = path.resolve(root);

  // Prevent path traversal
  if (!full.startsWith(rootResolved + path.sep) && full !== rootResolved) return null;
  return full;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const root = getWorkflowRoot();
  const rawId = decodeURIComponent(String(id ?? "")).trim();

  // Try a few sensible candidates:
  // - exact id (may already include ".json")
  // - id + ".json"
  // - if caller passes "presets/...", allow it
  // - if caller passes plain id, also try "presets/<id>.json"
  const candidates: string[] = [];

  if (rawId) {
    // exact
    candidates.push(rawId);

    // ensure .json
    if (!rawId.toLowerCase().endsWith(".json")) candidates.push(`${rawId}.json`);

    // try presets/<id>
    if (!rawId.startsWith("presets/")) {
      candidates.push(`presets/${rawId}`);
      if (!rawId.toLowerCase().endsWith(".json")) candidates.push(`presets/${rawId}.json`);
    }
  }

  try {
    // root must exist
    if (!fs.existsSync(root)) {
      return NextResponse.json(
        { ok: false, error: "Workflow root missing", root },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    }

    for (const rel of candidates) {
      const fp = resolveInsideRoot(root, rel);
      if (!fp) continue;
      if (!fs.existsSync(fp)) continue;

      const raw = fs.readFileSync(fp, "utf8");
      return new NextResponse(raw, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return NextResponse.json(
      { ok: false, error: "Workflow not found", tried: candidates, root },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e ?? "Failed to read workflow") },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
