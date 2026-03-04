import os, re, json
from pathlib import Path

ROOT = Path(os.getcwd())

def read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")

def write(p: Path, s: str):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s, encoding="utf-8")

def must_exist(p: Path):
    if not p.exists():
        raise SystemExit(f"Missing expected file: {p}")

# --- TARGET PATHS (patch both copies to avoid confusion) ---
WIDGETS = [
    ROOT / "app" / "app" / "components" / "FloatingQueueWidget.tsx",
    ROOT / "app" / "components" / "FloatingQueueWidget.tsx",
]
PROVIDERS = [
    ROOT / "app" / "app" / "components" / "FloatingQueueProvider.tsx",
    ROOT / "app" / "components" / "FloatingQueueProvider.tsx",
]
APP_PAGE = ROOT / "app" / "app" / "page.tsx"

# --- Provider: persist queue items + support focusId/promptId ---
PROVIDER_CONTENT = """'use client';

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
  focusId?: string;        // alias for resultName; stored for clarity
  promptId?: string;       // prompt_id if you want it distinct from id

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

export function FloatingQueueProvider({
  children,
}: {
  children: React.ReactNode;
}) {
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
    } catch {
      // ignore
    }
  }, [items]);

  const add = useCallback((item: Omit<QueueItem, 'createdAt'>) => {
    setItems((prev) => [{ ...item, createdAt: Date.now() }, ...prev]);
  }, []);

  const update = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
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
  if (!ctx) {
    throw new Error('useFloatingQueue must be used inside FloatingQueueProvider');
  }
  return ctx;
}
"""

# --- Widget: movable + numbers-only badge + status suffix + click completed -> gallery focus ---
WIDGET_CONTENT = """'use client';

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

  // Numbers only. Prefer active running/queued count; if none, show total items so it can still be opened.
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
    <div
      style={{
        position: 'fixed',
        right,
        bottom,
        zIndex: 9999,
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        aria-label={`Jobs: ${badgeCount}`}
        onMouseDown={(e) => {
          // allow drag
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
            const nx = drag.current.baseX - dx; // invert because we are using right/bottom
            const ny = drag.current.baseY - dy;
            setPos({ x: nx, y: ny });
          };

          const onUp = () => {
            drag.current.dragging = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            try {
              window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
            } catch {}
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
        onClick={() => {
          // if the mouse moved, treat it as drag (do not toggle)
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
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          fontWeight: 800,
          cursor: 'pointer',
          boxShadow: '0 8px 25px rgba(0,0,0,0.3)',
        }}
      >
        {badgeCount}
      </button>

      {isOpen && (
        <div
          style={{
            marginTop: 10,
            width: 320,
            background: '#111',
            color: '#fff',
            borderRadius: 12,
            padding: 12,
            boxShadow: '0 15px 40px rgba(0,0,0,0.5)',
          }}
        >
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
                  router.push(`/app?tab=gallery&focus=${f}`);
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
                title={clickable ? 'Open in Gallery' : ''}
              >
                {item.title}
                {statusSuffix(item.status)}
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
"""

def patch_queue_files():
    for p in PROVIDERS:
        must_exist(p)
        write(p, PROVIDER_CONTENT)

    for p in WIDGETS:
        must_exist(p)
        write(p, WIDGET_CONTENT)

def patch_app_page():
    must_exist(APP_PAGE)
    s = read(APP_PAGE)

    # ---------- Add focus state + helpers (id sanitize + scroll) ----------
    if "function toGalleryDomId(" not in s:
        # insert helper before isVideoName (exists in your file)
        s = s.replace(
            "function isVideoName(name: string) {",
            "function toGalleryDomId(name: string) {\n"
            "  const s = String(name || '');\n"
            "  return 'gallery_' + s.replace(/[^a-zA-Z0-9_-]/g, '_');\n"
            "}\n\n"
            "function isVideoName(name: string) {"
        )

    # Ensure focus state variables exist (insert near top after tab state)
    if "const [focusName, setFocusName]" not in s:
        s = s.replace(
            'const [tab, setTab] = useState<SpinTabId>("generate");',
            'const [tab, setTab] = useState<SpinTabId>("generate");\n'
            'const [focusName, setFocusName] = useState<string | null>(null);\n'
            'const [flashFocusName, setFlashFocusName] = useState<string | null>(null);\n'
        )

    # Read query params on mount
    if "new URLSearchParams(window.location.search)" not in s:
        # insert after first auth/admin effect (your file has one)
        # anchor: "}, []);" after whoami effect is present; we’ll place after the whoami effect block by searching the first occurrence.
        idx = s.find("}, []);")
        if idx != -1:
            insert_at = idx + len("}, []);")
            s = s[:insert_at] + "\n\n  // Deep-link: /app?tab=gallery&focus=<filename>\n  useEffect(() => {\n    try {\n      const qs = new URLSearchParams(window.location.search);\n      const t = (qs.get('tab') || '').trim();\n      const f = (qs.get('focus') || '').trim();\n      if (t) setTab(t as any);\n      if (f) setFocusName(decodeURIComponent(f));\n    } catch {}\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n" + s[insert_at:]

    # ---------- Persist UI state across refresh ----------
    # add hydration + save effects once
    if "otg:appState_v1" not in s:
        # place after state declarations (after currentPromptId state exists)
        anchor = "const [currentPromptId, setCurrentPromptId] = useState<string | null>(null);"
        if anchor in s:
            s = s.replace(
                anchor,
                anchor + "\n\n  // Persist UI state so refresh does not wipe the app.\n  const APP_STATE_KEY = 'otg:appState_v1';\n\n  useEffect(() => {\n    try {\n      const raw = localStorage.getItem(APP_STATE_KEY);\n      if (!raw) return;\n      const st = JSON.parse(raw);\n      if (st?.tab) setTab(st.tab);\n      if (typeof st?.fontDelta === 'number') setFontDelta(st.fontDelta);\n      if (typeof st?.workflowId === 'string') setWorkflowId(st.workflowId);\n      if (typeof st?.positivePrompt === 'string') setPositivePrompt(st.positivePrompt);\n      if (typeof st?.negativePrompt === 'string') setNegativePrompt(st.negativePrompt);\n      if (st?.orientation) setOrientation(st.orientation);\n      if (typeof st?.durationSeconds === 'string') setDurationSeconds(st.durationSeconds);\n      if (typeof st?.generationTitle === 'string') setGenerationTitle(st.generationTitle);\n      if (st?.sizePreset) setSizePreset(st.sizePreset);\n      if (Array.isArray(st?.loras)) setLoras(st.loras);\n      if (typeof st?.showGeneratedPreview === 'boolean') setShowGeneratedPreview(st.showGeneratedPreview);\n      if (typeof st?.animatePrompt === 'string') setAnimatePrompt(st.animatePrompt);\n      if (typeof st?.animateSeconds === 'number') setAnimateSeconds(st.animateSeconds);\n      if (st?.last) setLast(st.last);\n      if (st?.latestPreview) setLatestPreview(st.latestPreview);\n    } catch {\n      // ignore\n    }\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n\n  useEffect(() => {\n    const t = setTimeout(() => {\n      try {\n        const st = {\n          tab,\n          fontDelta,\n          workflowId,\n          positivePrompt,\n          negativePrompt,\n          orientation,\n          durationSeconds,\n          generationTitle,\n          sizePreset,\n          loras,\n          showGeneratedPreview,\n          animatePrompt,\n          animateSeconds,\n          last,\n          latestPreview,\n        };\n        localStorage.setItem(APP_STATE_KEY, JSON.stringify(st));\n      } catch {\n        // ignore\n      }\n    }, 250);\n    return () => clearTimeout(t);\n  }, [\n    tab,\n    fontDelta,\n    workflowId,\n    positivePrompt,\n    negativePrompt,\n    orientation,\n    durationSeconds,\n    generationTitle,\n    sizePreset,\n    loras,\n    showGeneratedPreview,\n    animatePrompt,\n    animateSeconds,\n    last,\n    latestPreview,\n  ]);\n"
            )

    # Rehydrate last prompt id for progress stream on refresh
    if "otg:lastPromptId" not in s:
        s = s.replace(
            "const [currentPromptId, setCurrentPromptId] = useState<string | null>(null);",
            "const [currentPromptId, setCurrentPromptId] = useState<string | null>(null);\n\n  useEffect(() => {\n    try {\n      const pid = localStorage.getItem('otg:lastPromptId');\n      if (pid && !currentPromptId) {\n        setCurrentPromptId(pid);\n        try { startProgressStream({ promptId: pid }); } catch {}\n      }\n    } catch {}\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n"
        )

    # When setting promptId after submit, store pointer (your file already does setCurrentPromptId(promptId) in multiple places)
    if "localStorage.setItem('otg:lastPromptId'" not in s:
        s = s.replace(
            "setCurrentPromptId(promptId);",
            "setCurrentPromptId(promptId);\n      try { localStorage.setItem('otg:lastPromptId', String(promptId)); } catch {}"
        )

    # ---------- Queue: set focusId/resultName on completion ----------
    # You currently have:
    # if (done) fq.update(currentPromptId, { status: "complete" });
    s = s.replace(
        'if (done) fq.update(currentPromptId, { status: "complete" });',
        'if (done) fq.update(currentPromptId, { status: "complete", resultName: (last?.file?.name ? String(last.file.name) : undefined), focusId: (last?.file?.name ? String(last.file.name) : undefined) });'
    )

    # ---------- Gallery: add DOM id + highlight ----------
    if "id={toGalleryDomId(f.name)}" not in s:
        s = s.replace(
            '<div key={f.name} className="otg-card" style={{ padding: 10, overflow: "hidden" }}>',
            '<div key={f.name} id={toGalleryDomId(f.name)} className="otg-card" style={{ padding: 10, overflow: "hidden", outline: (flashFocusName === f.name ? "2px solid rgba(124,58,237,0.9)" : "none") }}>'
        )

    # Scroll into view when tab=gallery and focusName set
    if "scrollIntoView({ behavior: 'smooth'" not in s:
        anchor = 'if (tab === "gallery") loadGallery().catch(() => void 0);'
        if anchor in s:
            s = s.replace(
                anchor,
                anchor + "\n    if (focusName) {\n      try {\n        const el = document.getElementById(toGalleryDomId(focusName));\n        if (el) {\n          el.scrollIntoView({ behavior: 'smooth', block: 'center' });\n          setFlashFocusName(focusName);\n          setTimeout(() => setFlashFocusName(null), 2000);\n        }\n      } catch {}\n    }\n"
            )

    # ---------- Reset App button in Settings ----------
    if "Reset App" not in s:
        # Insert into settings tab section (your UI has a Settings tab and uses Card components)
        # We locate the Settings render block by searching for 'tab === "settings"' and insert near its card content.
        m = re.search(r'\\{tab === "settings" \\? \\(.*?\\) : null\\}', s, flags=re.S)
        if m:
            block = m.group(0)
            if "Reset App" not in block:
                injection = """
              <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" }} />
              <div className="otg-help" style={{ marginTop: 0, fontSize: 14, color: "rgba(244,244,247,.86)" }}>App</div>
              <div className="otg-help" style={{ marginTop: 10 }}>
                Reset clears saved UI state (prompts, settings, queue) on this device only.
              </div>
              <div className="otg-row" style={{ marginTop: 10, justifyContent: "space-between" }}>
                <button
                  type="button"
                  className="otg-btnDanger"
                  disabled={uiLocked}
                  onClick={() => {
                    if (!confirm("Reset app state? This clears saved prompts/settings/queue on this device.")) return;
                    try {
                      const keys = Object.keys(localStorage).filter(k => k.startsWith("otg:"));
                      for (const k of keys) localStorage.removeItem(k);
                    } catch {}
                    try { fq.clearAll(); } catch {}
                    window.location.href = "/app";
                  }}
                  style={{ minWidth: 180 }}
                >
                  Reset App
                </button>
              </div>
"""
                # Insert injection before the closing of the first Settings Card if possible
                # Use a simple heuristic: insert before the last occurrence of "</Card>" within the settings block.
                b2 = block
                idx2 = b2.rfind("</Card>")
                if idx2 != -1:
                    b2 = b2[:idx2] + injection + b2[idx2:]
                    s = s[:m.start()] + b2 + s[m.end():]

    write(APP_PAGE, s)

def main():
    patch_queue_files()
    patch_app_page()
    print("OK: Applied queue + persistence + gallery focus + reset patch.")

if __name__ == "__main__":
    main()
