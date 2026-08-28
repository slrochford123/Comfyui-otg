import type { NextRequest } from "next/server";

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

export function expectedWorkerControlToken(): string {
  return cleanString(process.env.OTG_WORKER_CONTROL_TOKEN) || cleanString(process.env.OTG_WORKER_TOKEN);
}

export function workerControlTokenFromRequest(req: NextRequest): string {
  const auth = cleanString(req.headers.get("authorization"));
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return cleanString(req.headers.get("x-otg-worker-token"));
}

export function hasValidWorkerControlToken(req: NextRequest): boolean {
  const expected = expectedWorkerControlToken();
  if (!expected) return false;
  return workerControlTokenFromRequest(req) === expected;
}

export function requireWorkerControlToken(req: NextRequest): { ok: true } | { ok: false; status: 401; error: string } {
  if (hasValidWorkerControlToken(req)) return { ok: true };
  return {
    ok: false,
    status: 401,
    error: expectedWorkerControlToken()
      ? "Invalid or missing worker-control token."
      : "OTG_WORKER_CONTROL_TOKEN or OTG_WORKER_TOKEN is not configured.",
  };
}
