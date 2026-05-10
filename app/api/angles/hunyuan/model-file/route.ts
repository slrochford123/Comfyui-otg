import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.cwd();

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId || !/^[a-zA-Z0-9._-]+$/.test(jobId)) {
      return NextResponse.json({ ok: false, error: "Missing or invalid jobId." }, { status: 400 });
    }

    const file = path.join(ROOT, "data", "tmp", "angles_models", jobId, "hunyuan_textured.glb");
    const stat = await fs.stat(file);
    const body = await fs.readFile(file);

    return new Response(body, {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Length": String(stat.size),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 404 }
    );
  }
}
