// app/components/queue.ts
//
// Thin wrapper around app/lib/queue so the UI can import "legacy" names.
// Some parts of the UI expect addQueued/removeQueued/listQueued/clearQueued,
// while the storage layer exposes upsertQueueItem/deleteQueueItem/listQueued/clearQueue.

import type { QueueItem } from "../lib/queue";
import * as storage from "../lib/queue";

// Type-safe-ish “bridge” so we can support either name (listQueued or listQueue)
type StorageShape = {
  listQueued?: () => Promise<QueueItem[]>;
  listQueue?: () => Promise<QueueItem[]>;
  upsertQueueItem: (item: QueueItem) => Promise<void>;
  deleteQueueItem: (id: string) => Promise<void>;
  clearQueue: () => Promise<void>;
};

const s = storage as unknown as StorageShape;

// Prefer listQueued, fall back to listQueue if someone renamed it
const _list = (s.listQueued ?? s.listQueue) as () => Promise<QueueItem[]>;

// “New-ish” names (if any code uses them)
export const listQueue = _list;
export const upsertQueueItem = s.upsertQueueItem;
export const deleteQueueItem = s.deleteQueueItem;
export const clearQueue = s.clearQueue;

// Legacy/compat names used by the UI code
export const listQueued = _list;
export const addQueued = s.upsertQueueItem;
export const removeQueued = s.deleteQueueItem;
export const clearQueued = s.clearQueue;

export type { QueueItem };
