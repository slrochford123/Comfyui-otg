import { NextRequest, NextResponse } from "next/server";
import {productionStudioEnabled} from "@/lib/productionStudio/availability";
import { requireSessionUser } from "@/lib/sessionUser";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    return NextResponse.json(
      {
        enabled: productionStudioEnabled(),
        legacyAvailable:
          user.admin && process.env.OTG_PRODUCTION_LEGACY_VISIBLE !== "0",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Sign in to view Production v.2." },
      { status: 401 },
    );
  }
}
