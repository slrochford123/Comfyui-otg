"use client";

function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";

  const KEY = "otg_device_id";
  let id = window.localStorage.getItem(KEY);

  if (!id) {
    id = (globalThis.crypto?.randomUUID?.() ?? `dev_${Date.now()}_${Math.random()}`).toString();
    window.localStorage.setItem(KEY, id);
  }

  return id;
}

export async function otgFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? undefined);

  // Always attach device id
  headers.set("x-otg-device-id", getDeviceId());

  // If you're POSTing JSON, ensure content-type (safe even if already set)
  if (!headers.has("Content-Type") && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? "include",
  });
}
