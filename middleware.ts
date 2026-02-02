import { NextResponse, type NextRequest } from "next/server";

function getCookieNames() {
  const primary = process.env.AUTH_COOKIE_NAME || "otg_session";
  // Be tolerant: allow either cookie so prod/test can coexist even if middleware
  // was built without the env var.
  const set = new Set([primary, "otg_session", "otg_session_test"]);
  return Array.from(set);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const cookieNames = getCookieNames();
  const hasSession = cookieNames.some((n) => Boolean(req.cookies.get(n)?.value));

  // If already logged in, keep user out of /login.
  if (pathname.startsWith("/login") && hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

  // If not logged in, keep user out of /app.
  if (pathname.startsWith("/app") && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/app/:path*"],
};
