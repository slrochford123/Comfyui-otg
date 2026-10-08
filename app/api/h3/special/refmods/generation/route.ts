import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  cancelH3RefModsJob,
  createH3RefModsJob,
  ensureH3RefModsJobRunner,
  getH3RefModsJob,
  getLatestH3RefModsJob,
  h3RefModsPublicStatus,
  retryH3RefModsJob,
  startH3RefModsJob,
} from "@/lib/h3SpecialModes/refModsJobs";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "private, no-store",
      ...(init?.headers || {}),
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    const id = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const job = id ? await getH3RefModsJob(ownerKey, id) : await getLatestH3RefModsJob(ownerKey);
    if (!job) {
      return id
        ? noStore({ ok: false, error: "H3 Ref Mods generation job not found." }, { status: 404 })
        : noStore({ ok: true, job: null });
    }
    ensureH3RefModsJobRunner(job);
    return noStore({ ok: true, job: h3RefModsPublicStatus(job) });
  } catch (error) {
    if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    return noStore({
      ok: false,
      error: error instanceof Error ? error.message : "H3 Ref Mods generation status failed.",
    }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const { ownerKey } = owner;
    const body = await req.json().catch(() => null) as {
      action?: unknown;
      jobId?: unknown;
      config?: unknown;
    } | null;
    if (body?.action === "cancel") {
      const canceled = await cancelH3RefModsJob(ownerKey, String(body.jobId || ""));
      return noStore({ ok: true, job: h3RefModsPublicStatus(canceled) });
    }
    if (body?.action === "retry") {
      const source = await getH3RefModsJob(ownerKey, String(body.jobId || ""));
      if (!source) throw new Error("H3 Ref Mods generation job not found.");
      const retry = await retryH3RefModsJob(source);
      startH3RefModsJob(retry);
      return noStore({ ok: true, job: h3RefModsPublicStatus(retry) }, { status: 202 });
    }
    const config = body?.config && typeof body.config === "object"
      ? body.config as Record<string, unknown>
      : {};
    const job = await createH3RefModsJob(ownerKey, config, owner);
    startH3RefModsJob(job);
    return noStore({ ok: true, job: h3RefModsPublicStatus(job) }, { status: 202 });
  } catch (error) {
    if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    return noStore({
      ok: false,
      error: error instanceof Error ? error.message : "H3 Ref Mods generation request failed.",
    }, { status: 400 });
  }
}
