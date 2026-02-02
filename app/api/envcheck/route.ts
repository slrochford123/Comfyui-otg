import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return NextResponse.json({
    ok: true,
    supabaseUrlPresent: !!url,
    supabaseUrlStartsWithHttp: /^https?:\/\//i.test(url),
    serviceKeyLength: key.length,
    bucket: process.env.SUPABASE_BUCKET || "(unset)",
  });
}
