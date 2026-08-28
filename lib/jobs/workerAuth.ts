import { NextRequest } from "next/server";

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

export function expectedWorkerToken(): string {
  return cleanString(process.env.OTG_WORKER_TOKEN);
}

export function workerTokenFromRequest(req: NextRequest): string {
  const auth = cleanString(req.headers.get("authorization"));
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return cleanString(req.headers.get("x-otg-worker-token"));
}

export function hasValidWorkerToken(req: NextRequest): boolean {
  const expected = expectedWorkerToken();
  if (!expected) return false;
  return workerTokenFromRequest(req) === expected;
}

export function requireWorkerToken(req: NextRequest): { ok: true } | { ok: false; error: string; status: 401 } {
  if (hasValidWorkerToken(req)) return { ok: true };
  return {
    ok: false,
    status: 401,
    error: expectedWorkerToken()
      ? "Invalid or missing worker token."
      : "OTG_WORKER_TOKEN is not configured on the control-plane server.",
  };
}
