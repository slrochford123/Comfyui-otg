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

  // Always allow /login. A browser can hold a stale or invalid auth cookie,
  // especially across test/prod hosts; blocking /login would prevent recovery.
  if (pathname.startsWith("/login")) {
    return NextResponse.next();
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
