const ALLOWED_SOURCE_PROXY_PATHS = new Set([
  "/api/comfy/history-image",
  "/api/comfy-image",
  "/api/file",
  "/api/gallery/file",
]);

type HeaderReader = {
  get(name: string): string | null;
};

type InternalSourceProxyFetch = {
  sourceUrl: URL;
  fetchUrl: URL;
  headers: Headers;
};

function internalNextOrigin(requestOriginValue: string) {
  const parsed = new URL(requestOriginValue);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Selected preview request origin is not supported.");
  }

  // OTG_BACKGROUND_ANGLE_PLATE_REQUEST_ORIGIN_PP06_V1
  // The Next.js server may be bound to a specific interface rather than
  // loopback. Reuse the already validated request origin for internal
  // same-origin image proxy requests.
  return parsed.origin;
}

export function buildInternalSourceProxyFetch(args: {
  requestOrigin: string;
  sourceValue: string;
  requestHeaders: HeaderReader;
}): InternalSourceProxyFetch {
  const requestOrigin = internalNextOrigin(args.requestOrigin);
  const sourceUrl = new URL(args.sourceValue, requestOrigin);

  if (
    sourceUrl.origin !== requestOrigin ||
    !ALLOWED_SOURCE_PROXY_PATHS.has(sourceUrl.pathname)
  ) {
    throw new Error("Selected preview is not a supported OTG image reference.");
  }

  const fetchUrl = new URL(
    sourceUrl.pathname + sourceUrl.search,
    requestOrigin,
  );

  const headers = new Headers();
  const cookie = args.requestHeaders.get("cookie");
  const deviceId = args.requestHeaders.get("x-otg-device-id");
  if (cookie) headers.set("cookie", cookie);
  if (deviceId) headers.set("x-otg-device-id", deviceId);

  return { sourceUrl, fetchUrl, headers };
}
