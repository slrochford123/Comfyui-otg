import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      removed: true,
      label: "3D Model",
      error: "The separate 3D Model + Textures Angles path has been removed. Use /api/angles/model-3d, now backed by the TripoSplat 3D Model workflow.",
      replacementEndpoint: "/api/angles/model-3d"
    },
    { status: 410 }
  );
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      removed: true,
      label: "3D Model",
      error: "The separate texture route has been removed. Use /api/angles/model-3d.",
      replacementEndpoint: "/api/angles/model-3d"
    },
    { status: 410 }
  );
}
