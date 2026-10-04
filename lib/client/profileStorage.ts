export function normalizeProfileStorageOwner(ownerKey?: string | null): string {
  const raw = String(ownerKey || "").trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_.@-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "guest";
}

export function profileStorageKey(baseKey: string, ownerKey?: string | null): string {
  return `${baseKey}:profile:${encodeURIComponent(normalizeProfileStorageOwner(ownerKey))}`;
}

export function browserDeviceOwnerFallback(): string {
  if (typeof window === "undefined") return "guest";
  try {
    return (
      window.localStorage.getItem("otg_device_id") ||
      window.sessionStorage.getItem("otg_device_id") ||
      "guest"
    );
  } catch {
    return "guest";
  }
}

export async function resolveBrowserProfileStorageOwner(): Promise<string> {
  const fallback = browserDeviceOwnerFallback();
  if (typeof window === "undefined") return normalizeProfileStorageOwner(fallback);

  try {
    const response = await fetch(`/api/auth/me?ts=${Date.now()}`, {
      credentials: "include",
      cache: "no-store",
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
    if (response.ok) {
      const data = await response.json().catch(() => null);
      const user = data?.user || null;
      const owner = String(user?.username || user?.email || "").trim();
      if (owner) return normalizeProfileStorageOwner(owner);
    }
  } catch {
    // Use the device fallback when auth cannot be resolved yet.
  }

  return normalizeProfileStorageOwner(fallback);
}
