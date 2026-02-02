'use client';

import * as React from 'react';

type Mode = 'dark' | 'light';

function getStoredMode(): Mode | null {
  try {
    const v = window.localStorage.getItem('otg_theme');
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

function applyMode(mode: Mode) {
  const root = document.documentElement;
  if (mode === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
  try {
    window.localStorage.setItem('otg_theme', mode);
  } catch {}
}

export default function ThemeToggle() {
  const [mode, setMode] = React.useState<Mode>('dark');
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    const stored = getStoredMode();
    if (stored) {
      setMode(stored);
      applyMode(stored);
      return;
    }
    // Default: respect system preference
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
    const initial: Mode = prefersDark ? 'dark' : 'light';
    setMode(initial);
    applyMode(initial);
  }, []);

  const toggle = () => {
    const next: Mode = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    applyMode(next);
  };

  // Avoid hydration mismatch (renders nothing until mounted)
  if (!mounted) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      className="otg-pillBtn"
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      {mode === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}
