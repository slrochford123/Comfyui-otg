import { NextRequest } from "next/server";
import fs from "node:fs";
import {timingSafeEqual} from "node:crypto";

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
  let previous="";
  const previousFile=cleanString(process.env.OTG_WORKER_PREVIOUS_TOKEN_FILE);
  if(previousFile){try{previous=fs.readFileSync(previousFile,"utf8").trim();}catch{}}
  const candidate=Buffer.from(workerTokenFromRequest(req));
  return [expected,previous].filter(Boolean).some(token=>{const value=Buffer.from(token);return candidate.length===value.length&&timingSafeEqual(candidate,value);});
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
