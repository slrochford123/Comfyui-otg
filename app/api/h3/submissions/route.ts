import {NextRequest, NextResponse} from "next/server";
import {getOwnerContext, SessionInvalidError} from "@/lib/ownerKey";
import {requireSessionUser} from "@/lib/sessionUser";
import {readH3Submission, h3SubmissionReply} from "@/lib/h3SubmissionRecovery";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const headers = {"Cache-Control": "private, no-store"};
  try {
    await requireSessionUser(request);
    const owner = await getOwnerContext(request);
    const receipt = await readH3Submission(owner.ownerKey, request.nextUrl.searchParams.get("scope") || "", request.nextUrl.searchParams.get("requestId") || "");
    return receipt ? h3SubmissionReply(receipt) : NextResponse.json({ok: true, missing: true}, {status: 404, headers});
  } catch (error) {
    const auth = error instanceof SessionInvalidError || /unauthorized|session/i.test((error as Error).message);
    return NextResponse.json({error: auth ? "Sign in again. Your video inputs were kept." : "Invalid video request identity."}, {status: auth ? 401 : 400, headers});
  }
}
