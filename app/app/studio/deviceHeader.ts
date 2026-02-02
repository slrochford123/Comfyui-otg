const DEVICE_KEY = "otg_device_id";

function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";

  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function withDeviceHeader(): HeadersInit {
  const deviceId = getOrCreateDeviceId();
  return deviceId ? { "x-otg-device-id": deviceId } : {};
}
