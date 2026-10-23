import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { verifySession } from "@/lib/auth/jwt";
import { cookieName } from "@/lib/auth/cookies";
export async function videoTrimSession(request: NextRequest) {
  const user = await requireSessionUser(request);
  const session = await verifySession(request.cookies.get(cookieName())?.value || "");
  if (!session.sid) throw new Error("Invalid session");
  return { owner: user.ownerKey, session: crypto.createHash("sha256").update(String(session.sid)).digest("hex") };
}
