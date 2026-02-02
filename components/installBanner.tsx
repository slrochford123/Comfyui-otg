'use client';

import { useEffect, useMemo, useState } from 'react';

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export default function InstallBanner() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(true);

  const isStandalone = useMemo(() => {
    if (typeof window === 'undefined') return false;
    // iOS + some browsers
    // @ts-ignore
    const iosStandalone = window.navigator?.standalone === true;
    const mq = window.matchMedia?.('(display-mode: standalone)')?.matches;
    return Boolean(iosStandalone || mq);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };

    window.addEventListener('beforeinstallprompt', onBIP);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
    };
  }, []);

  // Don’t show if already installed or user dismissed
  if (isStandalone || dismissed) return null;

  // If browser never fires BIP (Safari iOS), you can still show instructions elsewhere.
  if (!deferred) return null;

  const host =
    typeof window !== 'undefined' ? window.location.host : 'this site';

  async function doInstall() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferred(null);
        setDismissed(true);
      } else {
        // keep available, but user can reopen
        setOpen(false);
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999]">
      {/* Top thin bar (dropdown header) */}
      <div className="w-full bg-emerald-700 text-white shadow">
        <div className="mx-auto max-w-6xl px-3 py-2 flex items-center gap-2">
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss install banner"
            className="h-8 w-8 grid place-items-center rounded hover:bg-white/10"
            title="Close"
          >
            ✕
          </button>

          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse' : 'Expand'}
            className="h-8 w-8 grid place-items-center rounded hover:bg-white/10"
            title={open ? 'Collapse' : 'Expand'}
          >
            {open ? '▾' : '▸'}
          </button>

          <div className="font-semibold tracking-wide">{host}</div>

          <div className="ml-auto flex items-center gap-2 opacity-90 text-sm">
            {/* optional placeholder icons */}
            <span title="Share">⤴</span>
            <span title="More">⋮</span>
          </div>
        </div>
      </div>

      {/* Drop-down body */}
      {open && (
        <div className="mx-auto max-w-6xl px-3 pt-2">
          <div className="rounded-2xl bg-zinc-900/95 border border-white/10 shadow-xl backdrop-blur p-3 flex items-center gap-3">
            {/* App icon (swap to your own if you want) */}
            <div className="h-10 w-10 rounded-xl bg-white/10 grid place-items-center text-lg">
              ⬚
            </div>

            <div className="min-w-0">
              <div className="font-semibold text-white">Install ComfyUI OTG</div>
              <div className="text-xs text-white/70 truncate">{host}</div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={doInstall}
                className="px-4 py-2 rounded-xl bg-white text-black font-semibold hover:opacity-90"
              >
                Install
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
