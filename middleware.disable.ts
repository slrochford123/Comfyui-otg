import { NextRequest, NextResponse } from "next/server";

function isPublicPath(pathname: string) {
  // public pages
  if (pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname.startsWith("/forgot-password")) return true;
  // allow all api routes (they enforce auth internally where needed)
  if (pathname.startsWith("/api")) return true;
  // allow next/static assets + icons
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/favicon") || pathname.startsWith("/icons") || pathname.startsWith("/brand") || pathname.startsWith("/images")) return true;
  if (pathname === "/manifest.json" || pathname.startsWith("/sw")) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();

  const cookieName = process.env.AUTH_COOKIE_NAME || "otg_session";
  const session = req.cookies.get(cookieName)?.value;

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("reason", "session");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // protect app shells
    "/app/:path*",
    "/gallery/:path*",
    "/history/:path*",
    "/settings/:path*",
    "/admin/:path*",
  ],
};
