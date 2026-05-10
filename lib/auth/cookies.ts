export function cookieName() {
  return process.env.AUTH_COOKIE_NAME || "otg_session";
}

const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

function configuredSessionMaxAgeSeconds() {
  const raw = Number(process.env.AUTH_SESSION_MAX_AGE_SECONDS || "");
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SESSION_MAX_AGE_SECONDS;

  // Browsers commonly cap persistent cookies at roughly 400 days.
  return Math.min(Math.floor(raw), DEFAULT_SESSION_MAX_AGE_SECONDS);
}

export const SESSION_MAX_AGE_SECONDS = configuredSessionMaxAgeSeconds();

function isLocalHost(host: string) {
  return host.includes("localhost") || /^\d+\.\d+\.\d+\.\d+(?::\d+)?$/.test(host);
}

function isHttpsRequest(req?: Request) {
  if (!req) return process.env.NODE_ENV === "production";

  try {
    const u = new URL(req.url);
    if (u.protocol === "https:") return true;
  } catch {}

  const xf = req.headers.get("x-forwarded-proto") || req.headers.get("x-forwarded-protocol");
  return Boolean(xf && xf.toLowerCase().includes("https"));
}

export function authCookieOptions(req?: Request, maxAge: number = SESSION_MAX_AGE_SECONDS) {
  const host = req?.headers.get("host") || "";
  const secure = isHttpsRequest(req) && !isLocalHost(host);

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge,
  };
}

export function clearAuthCookieOptions(req?: Request) {
  return authCookieOptions(req, 0);
}