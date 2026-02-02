import type { NextRequest } from "next/server";
import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";
import { getDeviceIdFromRequest, safeDeviceId } from "@/lib/otgDevice";

export type OwnerContext = {
  deviceId: string;
  username: string | null;
  ownerKey: string; // username if available, else deviceId
  scope: "user" | "device";
};

export class SessionInvalidError extends Error {
  status = 401 as const;
  constructor(message = "Session invalid") {
    super(message);
    this.name = "SessionInvalidError";
  }
}

function safeUsername(raw: string): string | null {
  const u = (raw || "").toString().trim();
  if (!u) return null;
  // keep folder-safe and predictable
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(u)) return null;
  return u;
}

export async function getOwnerContext(req: NextRequest): Promise<OwnerContext> {
  const fromReq = await getDeviceIdFromRequest(req);
  const deviceId = safeDeviceId(((fromReq || "local") as any).toString());

  // Prefer JWT cookie-based auth (used by /api/auth/login).
  let username: string | null = null;
  const token = req.cookies.get(cookieName())?.value || "";
  if (token) {
    try {
      const payload: any = await verifySession(token);
      username = safeUsername(payload?.username || "");
    } catch {
      // If a session cookie exists but is no longer valid (e.g. logged in elsewhere),
      // DO NOT silently fall back to device scope. Treat as unauthorized.
      throw new SessionInvalidError();
    }
  }

  const ownerKey = username || deviceId;
  return {
    deviceId,
    username,
    ownerKey,
    scope: username ? "user" : "device",
  };
}
