import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { maintenanceOperation, maintenanceTarget, MaintenanceError } from "@/lib/workers/maintenanceClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const activeOperations = new Set<string>();

function response(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function failed(error: unknown) {
  return response({ ok: false, error: error instanceof MaintenanceError ? error.message : "GPU maintenance is unavailable." }, error instanceof MaintenanceError ? error.status : 503);
}
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return response({ ok: false, error: admin.error }, admin.status);
  const target = maintenanceTarget(request.nextUrl.searchParams.get("target"));
  if (!target) return response({ ok: false, error: "Invalid GPU target." }, 400);
  try { return response({ ok: true, target, status: await maintenanceOperation(target, "status") }); }
  catch (error) { return failed(error); }
}
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return response({ ok: false, error: admin.error }, admin.status);
  const origin = request.headers.get("origin") || "";
  const allowedOrigins = String(process.env.OTG_GPU_CONTROLS_ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || !allowedOrigins.includes(origin) || request.headers.get("x-otg-gpu-control") !== "1" ||
      request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" ||
      (fetchSite !== null && !["same-origin", "none"].includes(fetchSite))) {
    return response({ ok: false, error: "Request origin verification failed." }, 403);
  }
  const body = await request.json().catch(() => null);
  if (!body || Object.keys(body).some(k => !["target", "action"].includes(k))) return response({ ok: false, error: "Invalid maintenance request." }, 400);
  const target = maintenanceTarget(body.target);
  if (!target) return response({ ok: false, error: "Invalid GPU target." }, 400);
  const action = body.action;
  if (action !== "free" && action !== "reset") return response({ ok: false, error: "Unrecognized GPU operation." }, 400);
  if (activeOperations.has(target)) return response({ ok: false, error: "Maintenance is already in progress for this GPU." }, 409);
  activeOperations.add(target);
  try {
    const status = await maintenanceOperation(target, action === "reset" ? "reset_comfy" : "free_vram");
    console.info("[otg-maintenance] completed", { operator: admin.username, target, action, time: new Date().toISOString() });
    return response({ ok: true, target, action, status });
  } catch (error) { return failed(error); }
  finally { activeOperations.delete(target); }
}
