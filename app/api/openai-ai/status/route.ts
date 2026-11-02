import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { SessionInvalidError } from "@/lib/ownerKey";
import { checkOpenAIConnection, openAIConnectionSnapshot } from "@/lib/openai/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
async function handle(request: NextRequest, check: boolean) {
  try {
    await requireSessionUser(request);
    const connection = check ? await checkOpenAIConnection() : openAIConnectionSnapshot();
    return NextResponse.json({ ok: true, connection }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof SessionInvalidError ? "Sign in to check OpenAI." : "OpenAI status unavailable." },
      { status: error instanceof SessionInvalidError ? 401 : 503, headers });
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
