import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const cookieName = process.env.AUTH_COOKIE_NAME || "otg_session";

  const res = NextResponse.json({ ok: true });

  // Clear cookie for most common paths
  res.cookies.set(cookieName, "", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  // Also clear possible test cookie variant (if you use otg_session_test)
  res.cookies.set(`${cookieName}_test`, "", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return res;
}
