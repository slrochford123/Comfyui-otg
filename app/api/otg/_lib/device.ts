import { NextRequest } from "next/server";

export function getDeviceId(req: NextRequest) {
  const url = new URL(req.url);
  return (
    url.searchParams.get("deviceId") ||
    req.headers.get("x-otg-device-id") ||
    "local"
  );
}
