const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function mustExist(p) {
  if (!fs.existsSync(p)) throw new Error("Missing expected file: " + p);
}

function write(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, "utf8");
}

const WIDGETS = [
  path.join(ROOT, "app", "app", "components", "FloatingQueueWidget.tsx"),
  path.join(ROOT, "app", "components", "FloatingQueueWidget.tsx"),
];
const PROVIDERS = [
  path.join(ROOT, "app", "app", "components", "FloatingQueueProvider.tsx"),
  path.join(ROOT, "app", "components", "FloatingQueueProvider.tsx"),
];
const APP_PAGE = path.join(ROOT, "app", "app", "page.tsx");

// Provider (persist queue + focusId/promptId)
const PROVIDER_CONTENT = `'use client';

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
`;

// Widget (movable + numbers only + status + click complete -> gallery)
const WIDGET_CONTENT = `'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useFloatingQueue } from './FloatingQueueProvider';
import { useRouter } from 'next/navigation';

function statusSuffix(s: string) {
  if (s === 'complete') return ' — complete';
  if (s === 'error') return ' — error';
  if (s === 'running') return ' — running';
  return ' — queued';
}

const POS_KEY = 'otg:queuePos';

export function FloatingQueueWidget() {
  const router = useRouter();
  const { items, isOpen, setOpen, clearAll } = useFloatingQueue();

  const activeCount = useMemo(
    () => items.filter((i) => i.status === 'queued' || i.status === 'running').length,
    [items]
  );

  // Numbers only (no label text).
  const badgeCount = activeCount > 0 ? activeCount : items.length;

  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    try {
      const raw = window.localStorage.getItem(POS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
    } catch {}
    return { x: 0, y: 0 };
  });

  const drag = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
    moved: false,
  });

  if (items.length === 0) return null;

  const right = 20 + pos.x;
  const bottom = 20 + pos.y;

  return (
    <div style={{ position: 'fixed', right, bottom, zIndex: 9999, userSelect: 'none' }}>
      <button
        type="button"
        aria-label={\`Jobs: \${badgeCount}\`}
        onMouseDown={(e) => {
          drag.current.dragging = true;
          drag.current.startX = e.clientX;
          drag.current.startY = e.clientY;
          drag.current.baseX = pos.x;
          drag.current.baseY = pos.y;
          drag.current.moved = false;

          const onMove = (ev: MouseEvent) => {
            if (!drag.current.dragging) return;
            const dx = ev.clientX - drag.current.startX;
            const dy = ev.clientY - drag.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.current.moved = true;
            const nx = drag.current.baseX - dx; // right-based
            const ny = drag.current.baseY - dy; // bottom-based
            setPos({ x: nx, y: ny });
          };

          const onUp = () => {
            drag.current.dragging = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            try { window.localStorage.setItem(POS_KEY, JSON.stringify({ x: pos.x, y: pos.y })); } catch {}
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
        onClick={() => {
          if (drag.current.moved) return;
          setOpen(!isOpen);
        }}
        style={{
          background: '#7c3aed',
          color: '#fff',
          border: 'none',
          borderRadius: 999,
          width: 44,
          height: 44,
          fontSize: 16,
          fontWeight: 800,
          cursor: 'pointer',
          boxShadow: '0 8px 25px rgba(0,0,0,0.3)',
        }}
      >
        {badgeCount}
      </button>

      {isOpen && (
        <div style={{
          marginTop: 10,
          width: 320,
          background: '#111',
          color: '#fff',
          borderRadius: 12,
          padding: 12,
          boxShadow: '0 15px 40px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 13, marginBottom: 8, opacity: 0.8 }}>Jobs</div>

          {items.map((item) => {
            const focus = item.focusId || item.resultName;
            const clickable = item.status === 'complete' && !!focus;

            return (
              <button
                key={item.id}
                type="button"
                disabled={!clickable}
                onClick={() => {
                  if (!clickable) return;
                  const f = encodeURIComponent(String(focus));
                  router.push(\`/app?tab=gallery&focus=\${f}\`);
                  setOpen(false);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  fontSize: 13,
                  padding: '8px 0',
                  cursor: clickable ? 'pointer' : 'default',
                  opacity: clickable ? 1 : 0.9,
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                {item.title}{statusSuffix(item.status)}
              </button>
            );
          })}

          <button
            type="button"
            onClick={clearAll}
            style={{
              marginTop: 10,
              width: '100%',
              background: '#222',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: 8,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}
`;

function patchQueueFiles() {
  for (const p of PROVIDERS) { mustExist(p); write(p, PROVIDER_CONTENT); }
  for (const p of WIDGETS) { mustExist(p); write(p, WIDGET_CONTENT); }
}

function patchAppPage() {
  mustExist(APP_PAGE);
  let s = fs.readFileSync(APP_PAGE, "utf8");

  // If you want persistence, but page.tsx doesn't have these exact state names, we stop and tell you.
  // Basic "quick win": persist tab/prompt/negative/orientation/size/duration by localStorage wrapper in page.tsx.
  // We'll only insert if we can find the expected anchors.
  const anchor = 'const [currentPromptId, setCurrentPromptId] = useState<string | null>(null);';
  if (!s.includes(anchor)) {
    throw new Error("page.tsx anchor not found. I need the exact state line for currentPromptId.");
  }

  if (!s.includes("otg:appState_v1")) {
    s = s.replace(anchor, anchor + `

  // Persist UI state so refresh does not wipe the app.
  const APP_STATE_KEY = 'otg:appState_v1';

  useEffect(() => {
    try {
      const raw = localStorage.getItem(APP_STATE_KEY);
      if (!raw) return;
      const st = JSON.parse(raw);
      if (st?.tab) setTab(st.tab);
      if (typeof st?.positivePrompt === 'string') setPositivePrompt(st.positivePrompt);
      if (typeof st?.negativePrompt === 'string') setNegativePrompt(st.negativePrompt);
      if (st?.orientation) setOrientation(st.orientation);
      if (st?.sizePreset) setSizePreset(st.sizePreset);
      if (typeof st?.durationSeconds === 'string') setDurationSeconds(st.durationSeconds);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const st = { tab, positivePrompt, negativePrompt, orientation, sizePreset, durationSeconds };
        localStorage.setItem(APP_STATE_KEY, JSON.stringify(st));
      } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [tab, positivePrompt, negativePrompt, orientation, sizePreset, durationSeconds]);
`);
  }

  // Rehydrate last prompt id
  if (!s.includes("otg:lastPromptId")) {
    s = s.replace(anchor, anchor + `

  useEffect(() => {
    try {
      const pid = localStorage.getItem('otg:lastPromptId');
      if (pid && !currentPromptId) {
        setCurrentPromptId(pid);
        try { startProgressStream({ promptId: pid }); } catch {}
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
`);
  }

  // Store pointer on submit
  if (!s.includes("localStorage.setItem('otg:lastPromptId'")) {
    s = s.replaceAll(
      "setCurrentPromptId(promptId);",
      "setCurrentPromptId(promptId);\n      try { localStorage.setItem('otg:lastPromptId', String(promptId)); } catch {}"
    );
  }

  fs.writeFileSync(APP_PAGE, s, "utf8");
}

patchQueueFiles();
patchAppPage();

console.log("OK: applied patch to queue widget/provider and added persistence hooks to page.tsx.");
