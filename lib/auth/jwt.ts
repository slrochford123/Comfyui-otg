import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth/cookies";

const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error("Missing AUTH_SECRET in .env.local");
const key = new TextEncoder().encode(secret);

type SignArgs = {
  sub: string;
  email: string;
  username?: string | null;
  tier?: string | null;
  sid: string;
};

export async function signSession(payload: SignArgs) {
  const now = Math.floor(Date.now() / 1000);

  const body: any = { email: payload.email, sid: payload.sid };
  if (payload.username) body.username = payload.username;
  if (payload.tier) body.tier = payload.tier;

  return await new SignJWT(body)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(key);
}

export async function verifySession(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, key);

  // Enforce single active session per user.
  const userId = String(payload.sub || "");
  const sid = String((payload as any).sid || "");
  if (!userId || !sid) throw new Error("Invalid session");

  const { db, ensureMigrations } = await import("@/lib/auth/db");
  ensureMigrations();

  const row = db.prepare("SELECT current_session_id FROM users WHERE id = ?").get(userId) as any;
  if (!row || String(row.current_session_id || "") !== sid) {
    throw new Error("Session revoked");
  }

  return payload;
}