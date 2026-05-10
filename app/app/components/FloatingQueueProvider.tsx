'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type QueueStatus = 'queued' | 'running' | 'complete' | 'error';

export type QueueItem = {
  id: string;
  title: string;
  status: QueueStatus;
  createdAt: number;
  resultName?: string;
  focusId?: string;
  promptId?: string;
  errorMessage?: string;
};

type FloatingQueueContextValue = {
  items: QueueItem[];
  add: (item: Omit<QueueItem, 'createdAt'>) => void;
  update: (id: string, patch: Partial<QueueItem>) => void;
  remove: (id: string) => void;
  clearAll: () => void;
  isOpen: boolean;
  setOpen: (v: boolean) => void;
};

const STORAGE_KEY = 'otg:queue';

const FloatingQueueContext =
  createContext<FloatingQueueContextValue | null>(null);

function shouldAutoOpen(status?: QueueStatus | string) {
  return status === 'queued' || status === 'running' || status === 'complete' || status === 'error';
}

export function FloatingQueueProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as QueueItem[]) : [];
      setItems(Array.isArray(parsed) ? parsed : []);
    } catch {
      setItems([]);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignore
    }
  }, [hydrated, items]);

  useEffect(() => {
    if (items.some((item) => shouldAutoOpen(item.status))) {
      setOpen(true);
    }
  }, [items]);

  const add = useCallback((item: Omit<QueueItem, 'createdAt'>) => {
    setItems((prev) => {
      const filtered = prev.filter((existing) => existing.id !== item.id);
      return [{ ...item, createdAt: Date.now() }, ...filtered];
    });
    if (shouldAutoOpen(item.status)) setOpen(true);
  }, []);

  const update = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((prev) => {
      const idx = prev.findIndex((existing) => existing.id === id);
      if (idx === -1) {
        const created: QueueItem = {
          id,
          title: String(patch.title || 'job'),
          status: (patch.status as QueueStatus) || 'queued',
          createdAt: Date.now(),
          resultName: patch.resultName,
          focusId: patch.focusId,
          promptId: patch.promptId,
          errorMessage: patch.errorMessage,
        };
        return [created, ...prev];
      }

      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });

    if (shouldAutoOpen(patch.status)) setOpen(true);
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(
    () => ({ items, add, update, remove, clearAll, isOpen, setOpen }),
    [items, add, update, remove, clearAll, isOpen]
  );

  return (
    <FloatingQueueContext.Provider value={value}>
      {children}
    </FloatingQueueContext.Provider>
  );
}

export function useFloatingQueue() {
  const ctx = useContext(FloatingQueueContext);
  if (!ctx) throw new Error('useFloatingQueue must be used inside FloatingQueueProvider');
  return ctx;
}
