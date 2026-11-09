import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { OTG_DATA_ROOT } from "@/lib/paths";
import {productionStudioEnabled} from "./availability";
import { requireSessionUser } from "@/lib/sessionUser";
import { createStudioStore, StudioError, type StudioStore } from "./store";
let instance: StudioStore | undefined;
export function studio() {
  return (instance ||= createStudioStore(
    path.join(OTG_DATA_ROOT, "production-studio"),
  ));
}
export function assertStudioEnabled() {
  if (!productionStudioEnabled())
    throw new StudioError(
      "Production v.2 is not available on this environment.",
      404,
    );
}
export async function authorize(req: NextRequest, write = false) {
  assertStudioEnabled();
  const user = await requireSessionUser(req);
  if (write) {
    const origin = req.headers.get("origin");
    let match = false;
    try {
      match = !!origin && new URL(origin).host === req.headers.get("host");
    } catch {}
    if (!match || req.headers.get("sec-fetch-site") === "cross-site")
      throw new StudioError(
        "Open Production v.2 in this app to make changes.",
        403,
      );
  }
  return user;
}
export async function body(req: NextRequest) {
  if (Number(req.headers.get("content-length")) > 1_000_000)
    throw new StudioError("Request too large.", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new StudioError("Request body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        throw new StudioError("Request too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StudioError("Invalid request.");
  }
}
export const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
export function failure(error: unknown) {
  const e = error as { status?: number; statusCode?: number; message?: string };
  const status = e.status || e.statusCode || 500;
  return json(
    {
      error:
        status === 500
          ? "Production could not complete this operation. Your saved work is preserved."
          : e.message,
    },
    status,
  );
}
