import os, re, json, sys
from pathlib import Path

ROOT = Path(os.getcwd())

def read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")

def write(p: Path, s: str):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s, encoding="utf-8")

def ensure_contains(haystack: str, needle: str, msg: str):
    if needle not in haystack:
        raise RuntimeError(msg)

def replace_once(text: str, pattern: str, repl: str, flags=0, desc="replace"):
    new, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        raise RuntimeError(f"{desc} failed: expected 1 match, got {n}")
    return new

def insert_after(text: str, anchor: str, insertion: str, desc="insert"):
    idx = text.find(anchor)
    if idx < 0:
        raise RuntimeError(f"{desc} failed: anchor not found")
    idx2 = idx + len(anchor)
    return text[:idx2] + insertion + text[idx2:]

def add_file_usePersistentState():
    p = ROOT / "app" / "app" / "lib" / "usePersistentState.ts"
    content = '''"use client";

import { useEffect, useState } from "react";

/**
 * localStorage-backed React state.
 * - Hydrates once on first client render.
 * - Writes on change.
 * - Never throws if storage is unavailable.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, [key, value]);

  return [value, setValue] as const;
}
'''
    write(p, content)

def patch_FloatingQueueProvider():
    p = ROOT / "app" / "app" / "components" / "FloatingQueueProvider.tsx"
    s = read(p)

    # If already patched, skip
    if "const STORAGE_KEY = 'otg:queue';" in s and "focusId?:" in s:
        return

    # 1) extend QueueItem type
    s = replace_once(
        s,
        r"(export type QueueItem = \{\s*id: string;\s*title: string;\s*status: QueueStatus;\s*createdAt: number;\s*)",
        r"\1  promptId?: string;\n  focusId?: string;\n",
        flags=re.M,
        desc="QueueItem extend"
    )

    # 2) init items from localStorage
    s = replace_once(
        s,
        r"const \[items, setItems\] = useState<QueueItem\[]>\(\[\]\);",
        """const STORAGE_KEY = 'otg:queue';
  const [items, setItems] = useState<QueueItem[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as QueueItem[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });""",
        flags=re.M,
        desc="items init from storage"
    )

    # 3) persist on change (insert after isOpen state line)
    anchor = "const [isOpen, setOpen] = useState(false);\n"
    if "Persist queue items" not in s:
        s = insert_after(
            s,
            anchor,
            """\n  // Persist queue items so refresh does not clear the widget.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignore
    }
  }, [items]);\n""",
            desc="insert persist effect"
        )

    # 4) clearAll also clears storage
    s = replace_once(
        s,
        r"const clearAll = useCallback\(\(\) => \{\s*setItems\(\[\]\);\s*\}, \[\]\);\s*",
        """const clearAll = useCallback(() => {
    setItems([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);\n""",
        flags=re.S,
        desc="clearAll storage clear"
    )

    write(p, s)

def patch_FloatingQueueWidget():
    p = ROOT / "app" / "app" / "components" / "FloatingQueueWidget.tsx"

    # Full rewrite (small file; safest)
    content = """'use client';

import React, { useMemo } from 'react';
import { useFloatingQueue } from './FloatingQueueProvider';
import { useRouter } from 'next/navigation';

function statusSuffix(s: string) {
  if (s === 'complete') return ' — complete';
  if (s === 'error') return ' — error';
  if (s === 'running') return ' — running';
  return ' — queued';
}

export function FloatingQueueWidget() {
  const router = useRouter();
  const { items, isOpen, setOpen, clearAll } = useFloatingQueue();

  const activeCount = useMemo(
    () => items.filter((i) => i.status === 'queued' || i.status === 'running').length,
    [items]
  );

  // Numbers only (no label text). If there are no active jobs,
  // fall back to total items so the widget can still be opened to view results.
  const badgeCount = activeCount > 0 ? activeCount : items.length;

  if (items.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <button
        onClick={() => setOpen(!isOpen)}
        aria-label={`Jobs: ${badgeCount}`}
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
          fontWeight: 700,
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
            width: 300,
            background: '#111',
            color: '#fff',
            borderRadius: 12,
            padding: 12,
            boxShadow: '0 15px 40px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ fontSize: 13, marginBottom: 8, opacity: 0.8 }}>Jobs</div>

          {items.map((item) => {
            const clickable = item.status === 'complete' && !!item.focusId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (!clickable) return;
                  const focus = encodeURIComponent(String(item.focusId));
                  router.push(`/app?tab=gallery&focus=${focus}`);
                  setOpen(false);
                }}
                disabled={!clickable}
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
    write(p, content)

def patch_AppPage():
    p = ROOT / "app" / "app" / "page.tsx"
    s = read(p)

    # Ensure we have the persistent hook import
    if "usePersistentState" not in s:
        s = s.replace(
            'import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";',
            'import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";\nimport { usePersistentState } from "./lib/usePersistentState";'
        )

    # Replace key useState -> usePersistentState (only if exact patterns found)
    replacements = [
        (r'const \[tab, setTab\] = useState<SpinTabId>\("generate"\);',
         'const [tab, setTab] = usePersistentState<SpinTabId>("otg:tab", "generate");'),

        (r'const \[fontDelta, setFontDelta\] = useState<number>\(0\);',
         'const [fontDelta, setFontDelta] = usePersistentState<number>("otg:fontDelta", 0);'),

        (r'const \[workflowId, setWorkflowId\] = useState<string>\("presets/t2i"\);',
         'const [workflowId, setWorkflowId] = usePersistentState<string>("otg:workflowId", "presets/t2i");'),

        (r'const \[positivePrompt, setPositivePrompt\] = useState<string>\(""\);',
         'const [positivePrompt, setPositivePrompt] = usePersistentState<string>("otg:positivePrompt", "");'),

        (r'const \[negativePrompt, setNegativePrompt\] = useState<string>\(""\);',
         'const [negativePrompt, setNegativePrompt] = usePersistentState<string>("otg:negativePrompt", "");'),

        (r'const \[orientation, setOrientation\] = useState<"portrait" \| "landscape">\("portrait"\);',
         'const [orientation, setOrientation] = usePersistentState<"portrait" | "landscape">("otg:orientation", "portrait");'),

        (r'const \[durationSeconds, setDurationSeconds\] = useState<string>\("5"\);',
         'const [durationSeconds, setDurationSeconds] = usePersistentState<string>("otg:durationSeconds", "5");'),

        (r'const \[generationTitle, setGenerationTitle\] = useState<string>\(""\);',
         'const [generationTitle, setGenerationTitle] = usePersistentState<string>("otg:generationTitle", "");'),

        (r'const \[sizePreset, setSizePreset\] = useState<"default" \| "480p" \| "512p" \| "720p">\("default"\);',
         'const [sizePreset, setSizePreset] = usePersistentState<"default" | "480p" | "512p" | "720p">("otg:sizePreset", "default");'),

        (r'const \[loras, setLoras\] = useState<OtgLoraChoice\[]>\(\[\]\);',
         'const [loras, setLoras] = usePersistentState<OtgLoraChoice[]>("otg:loras", []);'),
    ]
    for pat, repl in replacements:
        if re.search(pat, s):
            s = re.sub(pat, repl, s, count=1)
        else:
            # Do not hard fail for minor drift, but warn.
            pass

    # Persist currentPromptId pointer across refresh
    if "otg:lastPromptId" not in s:
        # Insert a hydration effect after currentPromptId state declaration
        # Find: const [currentPromptId, setCurrentPromptId] = useState<string | null>(null);
        if "const [currentPromptId, setCurrentPromptId] = useState<string | null>(null);" in s:
            s = s.replace(
                "const [currentPromptId, setCurrentPromptId] = useState<string | null>(null);",
                "const [currentPromptId, setCurrentPromptId] = useState<string | null>(null);\n"
                "\n  // Rehydrate last running prompt on refresh\n"
                "  useEffect(() => {\n"
                "    try {\n"
                "      const pid = localStorage.getItem('otg:lastPromptId');\n"
                "      if (pid && !currentPromptId) {\n"
                "        setCurrentPromptId(pid);\n"
                "        // Also restart SSE stream for this prompt_id so progress resumes\n"
                "        try { startProgressStream({ promptId: pid }); } catch {}\n"
                "      }\n"
                "    } catch {}\n"
                "    // eslint-disable-next-line react-hooks/exhaustive-deps\n"
                "  }, []);\n"
            )

    # When we receive a new promptId from /api/comfy submission, store it.
    # Find the block where promptId is set (existing code around: setCurrentPromptId(promptId);)
    if "localStorage.setItem('otg:lastPromptId'" not in s:
        s = s.replace(
            "setCurrentPromptId(promptId);",
            "setCurrentPromptId(promptId);\n      try { localStorage.setItem('otg:lastPromptId', String(promptId)); } catch {}"
        )

    # When job completes, attach focusId to queue item (use last.file.name when present)
    # We already update to complete/error; add focusId when complete and last.file exists.
    if "focusId:" not in s:
        s = s.replace(
            "if (done) fq.update(currentPromptId, { status: \"complete\" });",
            "if (done) fq.update(currentPromptId, { status: \"complete\", focusId: (last?.file?.name ? String(last.file.name) : undefined) });"
        )

    # URL-driven navigation: /app?tab=gallery&focus=FILENAME
    if "otg:focus" not in s:
        insert_anchor = "export default function AppPage() {\n"
        if insert_anchor in s:
            s = s.replace(
                insert_anchor,
                insert_anchor +
                "  const [focusName, setFocusName] = useState<string | null>(null);\n"
                "  const [flashFocusName, setFlashFocusName] = useState<string | null>(null);\n"
            )

        # Add mount effect to read query params
        if "const [focusName, setFocusName]" in s and "window.location.search" not in s:
            s = s.replace(
                "useEffect(() => {\n    (async () => {\n      try {\n        const r = await fetch(\"/api/whoami\", { credentials: \"include\", cache: \"no-store\" });\n        const data = await r.json().catch(() => null);\n        setIsAdmin(Boolean(data?.user?.admin));\n      } catch {\n        setIsAdmin(false);\n      }\n    })();\n  }, []);\n",
                "useEffect(() => {\n    (async () => {\n      try {\n        const r = await fetch(\"/api/whoami\", { credentials: \"include\", cache: \"no-store\" });\n        const data = await r.json().catch(() => null);\n        setIsAdmin(Boolean(data?.user?.admin));\n      } catch {\n        setIsAdmin(false);\n      }\n    })();\n  }, []);\n\n  // Allow deep-linking to tabs + focusing a gallery item (used by queue widget)\n  useEffect(() => {\n    try {\n      const qs = new URLSearchParams(window.location.search);\n      const t = (qs.get('tab') || '').trim();\n      const f = (qs.get('focus') || '').trim();\n      if (t) setTab(t as any);\n      if (f) setFocusName(decodeURIComponent(f));\n    } catch {\n      // ignore\n    }\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n"
            )

    # Add DOM id helper + scroll effect near gallery loading effect section
    if "function toGalleryDomId" not in s:
        # Add helper near isVideoName
        s = s.replace(
            "function isVideoName(name: string) {",
            "function toGalleryDomId(name: string) {\n"
            "  const s = String(name || '');\n"
            "  return 'gallery_' + s.replace(/[^a-zA-Z0-9_-]/g, '_');\n"
            "}\n\nfunction isVideoName(name: string) {"
        )

    # When gallery tab renders, ensure each card has id and highlight on focus
    # Patch the galleryFiles.map card wrapper: <div key={f.name} className="otg-card" ...>
    if "id={toGalleryDomId(f.name)}" not in s:
        s = s.replace(
            '<div key={f.name} className="otg-card" style={{ padding: 10, overflow: "hidden" }}>',
            '<div\n'
            '  key={f.name}\n'
            '  id={toGalleryDomId(f.name)}\n'
            '  className="otg-card"\n'
            '  style={{ padding: 10, overflow: "hidden", outline: (flashFocusName === f.name ? "2px solid rgba(124,58,237,0.9)" : "none") }}\n'
            '>'
        )

    # Scroll into view when focusName present and tab gallery
    if "scrollIntoView" not in s:
        # Put near: if (tab === "gallery") loadGallery().catch...
        anchor = "if (tab === \"gallery\") loadGallery().catch(() => void 0);"
        if anchor in s:
            s = s.replace(
                anchor,
                anchor +
                "\n    // Focus a specific gallery item (from ?focus=...)\n"
                "    if (focusName) {\n"
                "      try {\n"
                "        const id = toGalleryDomId(focusName);\n"
                "        const el = document.getElementById(id);\n"
                "        if (el) {\n"
                "          el.scrollIntoView({ behavior: 'smooth', block: 'center' });\n"
                "          setFlashFocusName(focusName);\n"
                "          setTimeout(() => setFlashFocusName(null), 2000);\n"
                "        }\n"
                "      } catch {}\n"
                "    }\n"
            )

    # Add Reset App button to Settings panel (localStorage otg:* clear)
    if "Reset App" not in s:
        marker = '<div className="otg-help" style={{ marginTop: 0, fontSize: 14, color: "rgba(244,244,247,.86)" }}>Display</div>'
        if marker in s:
            s = s.replace(
                marker,
                marker +
                "\n\n              <div style={{ height: 1, background: \"rgba(255,255,255,0.08)\", margin: \"14px 0\" }} />\n"
                "              <div className=\"otg-help\" style={{ marginTop: 0, fontSize: 14, color: \"rgba(244,244,247,.86)\" }}>App</div>\n"
                "              <div className=\"otg-help\" style={{ marginTop: 10 }}>\n"
                "                Reset clears saved UI state (prompts, settings, queue) without touching your server gallery.\n"
                "              </div>\n"
                "              <div className=\"otg-row\" style={{ marginTop: 10, justifyContent: \"space-between\" }}>\n"
                "                <button\n"
                "                  type=\"button\"\n"
                "                  className=\"otg-btnDanger\"\n"
                "                  disabled={uiLocked}\n"
                "                  onClick={() => {\n"
                "                    if (!confirm('Reset app state? This clears saved prompts/settings/queue on this device.')) return;\n"
                "                    try {\n"
                "                      const keys = Object.keys(localStorage).filter(k => k.startsWith('otg:'));\n"
                "                      for (const k of keys) localStorage.removeItem(k);\n"
                "                      // keep device id stable\n"
                "                      const dev = localStorage.getItem('otg_device_id');\n"
                "                      if (dev) localStorage.setItem('otg_device_id', dev);\n"
                "                    } catch {}\n"
                "                    try { fq.clearAll(); } catch {}\n"
                "                    window.location.href = '/app';\n"
                "                  }}\n"
                "                  style={{ minWidth: 180 }}\n"
                "                >\n"
                "                  Reset App\n"
                "                </button>\n"
                "              </div>\n"
            )

    write(p, s)

def main():
    # Verify expected files exist
    must = [
        ROOT / "app" / "app" / "page.tsx",
        ROOT / "app" / "app" / "components" / "FloatingQueueProvider.tsx",
        ROOT / "app" / "app" / "components" / "FloatingQueueWidget.tsx",
    ]
    for f in must:
        if not f.exists():
            raise RuntimeError(f"Missing expected file: {f}")

    add_file_usePersistentState()
    patch_FloatingQueueProvider()
    patch_FloatingQueueWidget()
    patch_AppPage()

    print("OK: Patch applied.")

if __name__ == "__main__":
    main()
