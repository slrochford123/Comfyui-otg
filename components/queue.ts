/**
 * Compatibility shim for legacy imports.
 *
 * pass1_ui/page.tsx imports `../components/queue`.
 * Some branches moved queue helpers elsewhere; this module keeps the build green.
 *
 * NOTE: If you have a real queue implementation, replace these no-op stubs
 * with re-exports to your actual queue module.
 */

export type QueueItem = Record<string, any>;

/** Add an item to the queue (legacy). */
export function addQueued(_item: QueueItem): void {
  // No-op shim: pass1_ui is legacy and not part of the locked baseline UI.
}

/** Optional helper: read queued items (legacy). */
export function getQueue(): QueueItem[] {
  return [];
}
