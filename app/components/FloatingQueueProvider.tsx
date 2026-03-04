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

  // Used to deep-link to gallery when completed
  resultName?: string;     // typically output filename
  focusId?: string;        // alias for resultName
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

export function FloatingQueueProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<QueueItem[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as QueueItem[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [isOpen, setOpen] = useState(false);

  // Persist across refresh
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, [items]);

  const add = useCallback((item: Omit<QueueItem, 'createdAt'>) => {
    setItems((prev) => [{ ...item, createdAt: Date.now() }, ...prev]);
  }, []);

  const update = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
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
