"use client";

export const OTG_DEVICE_STORAGE_KEY = "otg_device_id";

export function getOrCreateOtgDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(OTG_DEVICE_STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(OTG_DEVICE_STORAGE_KEY, id);
  }
  return id;
}

/**
 * Same-origin fetch helper that automatically attaches the OTG device id.
 * Your API routes can read this from the `x-otg-device-id` header.
 */
export async function otgFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const deviceId = getOrCreateOtgDeviceId();
  const headers = new Headers(init.headers || {});
  headers.set("x-otg-device-id", deviceId);
  return fetch(input, { ...init, headers });
}
