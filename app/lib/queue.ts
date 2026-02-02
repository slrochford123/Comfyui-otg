// app/lib/queue.ts
// IndexedDB-backed offline queue for OTG.
// Exports both the “real” function names and legacy aliases used elsewhere.

export type QueueItem = {
  id?: string; // ✅ optional (we’ll auto-generate if missing)
  type: "submit" | "upload";
  payload: any; // payload is flexible; we validate server-side
  createdAt?: number;
};

const DB_NAME = "comfy-otg";
const STORE = "queue";

function genId(prefix = "q") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function upsertQueueItem(item: QueueItem): Promise<void> {
  const db = await openDB();
  const normalized = {
    ...item,
    id: item.id ?? genId(item.type),
    createdAt: item.createdAt ?? Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(normalized);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

export async function listQueued(): Promise<QueueItem[]> {
  const db = await openDB();
  const items = await new Promise<QueueItem[]>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueueItem[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return (items || []).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export async function deleteQueueItem(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function clearQueue(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// ---- Legacy/compat exports (so older code keeps compiling) ----
export const listQueue = listQueued;
export const addQueued = upsertQueueItem;
export const removeQueued = deleteQueueItem;
export const clearQueued = clearQueue;
