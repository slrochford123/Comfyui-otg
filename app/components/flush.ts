function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}


// app/components/flush.ts
// Flush any offline-queued items when network is back.
// This is used by app/page.tsx

import { listQueued, removeQueued } from "./queue";

type OfflineQueuedItem =
  | {
      id?: string;
      type: "submit";
      payload: unknown;
    }
  | {
      id?: string;
      type: "upload";
      payload: { dataUrl: string; filename: string };
    };

function getId(item: OfflineQueuedItem): string {
  // If your lib queue items always have id, this is just safety.
  return item.id || `tmp_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export async function flushQueue(): Promise<void> {
  const itemsRaw = (await listQueued()) as unknown;

  const items = Array.isArray(itemsRaw) ? (itemsRaw as OfflineQueuedItem[]) : [];
  for (const item of items) {
    const id = getId(item);
    try {
      if (item.type === "submit") {
        const res = await fetch("/api/comfy", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-otg-device-id": (getDeviceId() ?? "desktop_default") },
          body: JSON.stringify(item.payload),
        });
        if (!res.ok) throw new Error(`submit failed: ${res.status}`);
        await removeQueued(id);
      } else if (item.type === "upload") {
        const r1 = await fetch(item.payload.dataUrl);
        const blob = await r1.blob();
        const form = new FormData();
        form.append("file", blob, item.payload.filename);

        const res = await fetch("/api/comfy-upload", { method: "POST", body: form });
        if (!res.ok) throw new Error(`upload failed: ${res.status}`);
        await removeQueued(id);
      }
    } catch {
      // Stop on first failure so we donâ€™t loop spam while offline.
      break;
    }
  }
}

