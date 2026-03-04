import { NextRequest } from "next/server";
import { isAdminSession, getComfyTargets } from "@/app/api/_lib/comfyTarget";

type TargetStatus = { id: string; online: boolean };

async function ping(baseUrl: string, timeoutMs = 1200): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/system_stats`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function GET(_req: NextRequest) {
  const okAdmin = await isAdminSession();
  if (!okAdmin) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const targets = getComfyTargets();
  const statuses: TargetStatus[] = await Promise.all(
    targets.map(async (t) => ({ id: t.id, online: await ping(t.baseUrl) }))
  );

  return Response.json({ ok: true, statuses }, { headers: { "Cache-Control": "no-store" } });
}
