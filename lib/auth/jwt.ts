import { SignJWT, jwtVerify } from "jose";
import { db, ensureMigrations } from "@/lib/auth/db";

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

export async function signSession(payload: SignArgs, remember: boolean) {
  const expiresIn = remember ? "30d" : "12h";
  const body: any = { email: payload.email, sid: payload.sid };
  if (payload.username) body.username = payload.username;
  if (payload.tier) body.tier = payload.tier;

  return await new SignJWT(body)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function verifySession(token: string) {
  const { payload } = await jwtVerify(token, key);

  // Enforce single active session per user.
  ensureMigrations();
  const userId = String(payload.sub || "");
  const sid = String((payload as any).sid || "");
  if (!userId || !sid) throw new Error("Invalid session");

  const row = db.prepare("SELECT current_session_id FROM users WHERE id = ?").get(userId) as any;
  if (!row || String(row.current_session_id || "") !== sid) {
    throw new Error("Session revoked");
  }

  return payload;
}
