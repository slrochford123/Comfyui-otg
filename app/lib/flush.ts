function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}

// app/lib/flush.ts
import { listQueue, removeQueued, addQueued, type QueueItem } from "./queue";

export async function flushQueue() {
  const items = await listQueue();

  for (const item of items) {
    try {
      // Safety: ensure an id exists (older items might not)
      if (!item.id) {
        await addQueued(item as QueueItem); // upsert will generate id
        continue; // it will be retried next flush tick with an id
      }

      if (item.type === "submit") {
        const r = await fetch("/api/comfy", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-otg-device-id": (getDeviceId() ?? "desktop_default") },
          body: JSON.stringify(item.payload),
        });
        if (!r.ok) throw new Error(`submit failed: ${r.status}`);
        await removeQueued(item.id);
      }

      if (item.type === "upload") {
        const res = await fetch(item.payload.dataUrl);
        const blob = await res.blob();
        const form = new FormData();
        form.append("file", blob, item.payload.filename);

        const r = await fetch("/api/comfy-upload", { method: "POST", body: form });
        if (!r.ok) throw new Error(`upload failed: ${r.status}`);
        await removeQueued(item.id);
      }
    } catch {
      // stop on first failure (likely offline) to avoid thrashing
      break;
    }
  }
}


