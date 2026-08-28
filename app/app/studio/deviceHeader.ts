const DEVICE_KEY = "otg_device_id";

function fallbackUuid(): string {
  const rnd = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${Date.now().toString(16)}-${rnd()}-${rnd()}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
}

function getSafeRandomUuid(): string {
  try {
    const c: any = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch {
    // ignore
  }
  return fallbackUuid();
}

function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";

  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = getSafeRandomUuid();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function withDeviceHeader(): HeadersInit {
  const deviceId = getOrCreateDeviceId();
  return deviceId ? { "x-otg-device-id": deviceId } : {};
}
