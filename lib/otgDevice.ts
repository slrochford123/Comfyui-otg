import type { NextRequest } from "next/server";
import { headers } from "next/headers";

/**
 * Next.js 15 compatibility layer for device-id helpers.
 *
 * Why this file exists:
 * - In Next.js 15, headers() is typed as Promise<ReadonlyHeaders> in many contexts,
 *   so we must await it.
 * - Several routes import these helpers: safeDeviceId, safeSegment, getDeviceIdFromRequest.
 */

/** Allow only simple, filesystem-safe segments (no slashes, no traversal). */
export function safeSegment(v: string): string {
  const s = (v ?? "").trim();
  // Replace anything not alnum, underscore, dash, or dot.
  const cleaned = s.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Prevent traversal / empty segments.
  if (!cleaned || cleaned === "." || cleaned === "..") return "";
  // Avoid Windows reserved trailing dots/spaces.
  return cleaned.replace(/[. ]+$/g, "");
}

/** Normalizes a deviceId and guarantees filesystem safety. */
export function safeDeviceId(deviceId: string): string {
  // Keep it predictable and short-ish.
  const seg = safeSegment(deviceId);
  return seg.slice(0, 80);
}

/**
 * Reads device id from request:
 * - headers: x-otg-device-id, x-device-id, x-deviceid
 * - query: deviceId, device_id
 * - json body: {deviceId} / {device_id}
 */
export async function getDeviceIdFromRequest(req: NextRequest): Promise<string> {
  const h = req.headers;

  const fromHeader =
    h.get("x-otg-device-id") || h.get("x-device-id") || h.get("x-deviceid");
  if (fromHeader) return safeDeviceId(fromHeader);

  const sp = req.nextUrl?.searchParams;
  const fromQuery = sp?.get("deviceId") || sp?.get("device_id");
  if (fromQuery) return safeDeviceId(fromQuery);

  try {
    const ct = h.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = (await req.json()) as any;
      const v =
        (typeof body?.deviceId === "string" && body.deviceId) ||
        (typeof body?.device_id === "string" && body.device_id) ||
        "";
      if (v) return safeDeviceId(v);
    }
  } catch {
    // ignore parse errors
  }

  return "";
}

/**
 * Convenience helper for server components / route handlers that use next/headers.
 * Next.js 15: headers() may be a Promise, so always await.
 */
export async function getOtgDeviceId(): Promise<string> {
  try {
    const hh = await headers();
    const v =
      hh.get("x-otg-device-id") || hh.get("x-device-id") || hh.get("x-deviceid") || "";
    if (v) return safeDeviceId(v);
  } catch {
    // ignore
  }
  return "";
}
