import type { NextRequest } from "next/server";

/**
 * iOS/Safari will NOT persist a Secure cookie when you're using http:// (common on LAN/Tailscale).
 * This helper sets `secure` only when the request is actually HTTPS (or forwarded as HTTPS).
 *
 * Use it as:
 *   cookies().set(cookieName(), token, cookieOptions(req))
 */
export function cookieOptions(req: NextRequest) {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const isHttps = forwardedProto === "https" || req.nextUrl.protocol === "https:";

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isHttps, // ✅ key fix for iPhone on http://
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };
}
