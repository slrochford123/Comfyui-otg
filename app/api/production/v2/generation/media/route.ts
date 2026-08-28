import fs from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { mediaFileResponse } from "@/lib/mediaResponse";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";
import { getProductionV2GenerationJob } from "@/lib/production/h3GenerationJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serve(req: NextRequest, method: "GET" | "HEAD") {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const { ownerKey } = await getOwnerContext(req);
    const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const job = jobId ? getProductionV2GenerationJob(jobId, ownerKey) : null;
    if (!job?.outputPath || job.status !== "completed") return NextResponse.json({ ok: false, error: "Generated video not found." }, { status: 404 });
    const ownerRoot = safeJoin(OTG_DATA_ROOT, "productions-v2", safeSegment(ownerKey));
    const resolved = path.resolve(job.outputPath);
    const relative = path.relative(ownerRoot, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved)) {
      return NextResponse.json({ ok: false, error: "Generated video path is invalid." }, { status: 404 });
    }
    return mediaFileResponse(req, resolved, { method, cacheControl: "private, no-transform, max-age=3600" });
  } catch (error) {
    if (error instanceof SessionInvalidError) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not serve generated video." }, { status: 500 });
  }
}

export function GET(req: NextRequest) {
  return serve(req, "GET");
}

export function HEAD(req: NextRequest) {
  return serve(req, "HEAD");
}
