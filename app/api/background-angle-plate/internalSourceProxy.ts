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

function internalNextOrigin(portValue = process.env.PORT) {
  const candidate = String(portValue || "").trim();
  const parsedPort = /^\d+$/.test(candidate) ? Number(candidate) : 0;
  const port = parsedPort >= 1 && parsedPort <= 65_535 ? String(parsedPort) : "3000";

  return `http://127.0.0.1:${port}`;
}

export function buildInternalSourceProxyFetch(args: {
  requestOrigin: string;
  sourceValue: string;
  requestHeaders: HeaderReader;
  port?: string;
}): InternalSourceProxyFetch {
  const requestOrigin = new URL(args.requestOrigin).origin;
  const sourceUrl = new URL(args.sourceValue, requestOrigin);

  if (
    sourceUrl.origin !== requestOrigin ||
    !ALLOWED_SOURCE_PROXY_PATHS.has(sourceUrl.pathname)
  ) {
    throw new Error("Selected preview is not a supported OTG image reference.");
  }

  const fetchUrl = new URL(
    sourceUrl.pathname + sourceUrl.search,
    internalNextOrigin(args.port),
  );

  const headers = new Headers();
  const cookie = args.requestHeaders.get("cookie");
  const deviceId = args.requestHeaders.get("x-otg-device-id");
  if (cookie) headers.set("cookie", cookie);
  if (deviceId) headers.set("x-otg-device-id", deviceId);

  return { sourceUrl, fetchUrl, headers };
}
