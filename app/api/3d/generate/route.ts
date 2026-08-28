import { NextRequest, NextResponse } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { createThreeDJob, launchThreeDJob } from "@/lib/threeDJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseBool(value: FormDataEntryValue | null) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export async function POST(req: NextRequest) {
  let owner;
  try {
    owner = await getOwnerContext(req);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }

  try {
    const fd = await req.formData();
    const image = fd.get("image");
    const removeBackground = parseBool(fd.get("removeBackground"));
    if (!image || typeof image === "string") {
      return NextResponse.json({ ok: false, error: "Missing image file" }, { status: 400 });
    }

    const bytes = Buffer.from(await image.arrayBuffer());
    if (!bytes.length) {
      return NextResponse.json({ ok: false, error: "Image file is empty" }, { status: 400 });
    }

    const job = await createThreeDJob({
      ownerKey: owner.ownerKey,
      deviceId: owner.deviceId,
      fileName: image.name || `image_${Date.now()}.png`,
      inputBytes: bytes,
      inputMime: image.type || "image/png",
      removeBackground,
    });

    const cookieHeader = req.headers.get("cookie") || "";
    const baseUrl = new URL(req.url).origin;
    launchThreeDJob(owner.ownerKey, {
      jobId: job.jobId,
      baseUrl,
      cookieHeader,
      deviceId: owner.deviceId,
    });

    return NextResponse.json(
      {
        ok: true,
        jobId: job.jobId,
        status: job.status,
        message: "3D job created. Poll /api/3d/status with the returned jobId.",
        inputImageUrl: job.inputImageUrl,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
