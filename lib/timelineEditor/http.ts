import { NextRequest, NextResponse } from "next/server";
import { SessionInvalidError } from "@/lib/ownerKey";
import { RequestError } from "@/lib/requestError";

export const editorHeaders = { "Cache-Control": "private, no-store" };
export function editorFailure(error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error:
        error instanceof Error ? error.message : "The editor request failed.",
    },
    {
      status:
        error instanceof SessionInvalidError
          ? 401
          : error instanceof RequestError
            ? error.status
            : 500,
      headers: editorHeaders,
    },
  );
}
export function requireEditorOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host"))
    throw new RequestError("Cross-origin editor actions are not allowed.", 403);
}
