import type { NextRequest } from "next/server";
import { cookies as nextCookies } from "next/headers";

import { cookieName } from "@/lib/auth/cookies";
import { isAdminUserId } from "@/lib/auth/admin";
import { verifySession } from "@/lib/auth/jwt";
import { safeDeviceId, getDeviceIdFromRequest, getOtgDeviceId } from "@/lib/otgDevice";
import { SessionInvalidError } from "@/lib/ownerKey";
import { resolveOwnerAlias } from "@/lib/ownerAlias";

export type OwnerContextLite = {
  deviceId: string;
  username: string | null;
  ownerKey: string; // username if available, else deviceId
  scope: "user" | "device";
};

export type SessionUser = OwnerContextLite & {
  accountId?: string;
  email: string | null;
  tier: string | null;
  admin: boolean;
};

function safeUsername(raw: string): string | null {
  const u = (raw || "").toString().trim();
  if (!u) return null;
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(u)) return null;
  return u;
}

async function readToken(req?: Request | NextRequest): Promise<string> {
  try {
    const anyReq: any = req as any;
    const direct = anyReq?.cookies?.get?.(cookieName())?.value;
    if (direct) return String(direct).trim();
  } catch {
    // ignore
  }

  // Fallback to next/headers cookies() for handlers typed as Request
  try {
    const store = await nextCookies();
    return String(store.get(cookieName())?.value || "").trim();
  } catch {
    return "";
  }
}

async function ownerContext(req: Request | NextRequest): Promise<OwnerContextLite> {
  let deviceId = "";

  // Prefer request-derived device id when available.
  try {
    const anyReq: any = req as any;
    if (anyReq?.nextUrl && typeof anyReq?.headers?.get === "function") {
      deviceId = safeDeviceId((await getDeviceIdFromRequest(anyReq as NextRequest)) || "");
    }
  } catch {
    // ignore
  }

  // Fallback to next/headers() based helper
  if (!deviceId) {
    deviceId = safeDeviceId((await getOtgDeviceId()) || "local");
  }
  if (!deviceId) deviceId = "local";

  const token = await readToken(req);
  if (!token) {
    return { deviceId, username: null, ownerKey: deviceId, scope: "device" };
  }

  // validate token and extract username
  const payload: any = await verifySession(token);
  const username = safeUsername(payload?.username || "") || null;
  const ownerKey = resolveOwnerAlias(username || deviceId);
  return { deviceId, username, ownerKey, scope: username ? "user" : "device" };
}

/**
 * Strict: requires a valid session cookie. Throws SessionInvalidError on missing/invalid session.
 */
export async function requireSessionUser(req: Request | NextRequest): Promise<SessionUser> {
  const token = await readToken(req);
  if (!token) throw new SessionInvalidError("Missing session");

  const payload: any = await verifySession(token);

  const ctx = await ownerContext(req);
  const email = (payload as any).email ?? (payload as any).sub ?? null;
  const username = safeUsername((payload as any).username || "") || ctx.username || null;
  const tier = (payload as any).tier ?? null;
  const admin = isAdminUserId(payload.sub);

  return { ...ctx, username, email, tier, admin, accountId: String(payload.sub) };
}

/**
 * Lenient: returns device-scoped context when no cookie exists; throws only if a cookie exists but is invalid.
 */
export async function getSessionUser(req: Request | NextRequest): Promise<SessionUser> {
  const token = await readToken(req);
  const ctx = await ownerContext(req);

  if (!token) {
    return { ...ctx, email: null, tier: null, admin: false };
  }

  // If token exists but is invalid, verifySession() will throw (same behavior as OTG Law).
  const payload: any = await verifySession(token);
  const email = (payload as any).email ?? (payload as any).sub ?? null;
  const username = safeUsername((payload as any).username || "") || ctx.username || null;
  const tier = (payload as any).tier ?? null;
  const admin = isAdminUserId(payload.sub);

  const ownerKey = resolveOwnerAlias(username || ctx.deviceId);
  return { ...ctx, username, ownerKey, scope: username ? "user" : "device", email, tier, admin, accountId: String(payload.sub) };
}

// Back-compat aliases (some routes/patterns use these names)
export const requireUser = requireSessionUser;
export const getUser = getSessionUser;
export { SessionInvalidError };
