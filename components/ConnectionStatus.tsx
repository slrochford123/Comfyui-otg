'use client';

import React, { useEffect, useMemo, useState } from 'react';

type Props = {
  apiBase?: string;
  target?: string;
  error?: string;
  /** Optional: show yellow "running" state while a prompt is executing */
  isBusy?: boolean;
};

export default function ConnectionStatus({ apiBase, target, error, isBusy }: Props) {
  const [ok, setOk] = useState<boolean>(false);

  const url = useMemo(() => {
    const base = (apiBase || '').trim();
    if (!base) return '';
    return base.replace(/\/$/, '') + '/system_stats';
  }, [apiBase]);

  useEffect(() => {
    let alive = true;
    if (!url) {
      setOk(false);
      return;
    }

    const poll = async () => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!alive) return;
        setOk(r.ok);
      } catch {
        if (!alive) return;
        setOk(false);
      }
    };

    poll();
    const id = setInterval(poll, 4500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [url]);

  const state: 'error' | 'busy' | 'connected' | 'disconnected' = error
    ? 'error'
    : ok
      ? (isBusy ? 'busy' : 'connected')
      : 'disconnected';

  const label =
    state === 'connected'
      ? 'ComfyUI Connected'
      : state === 'busy'
        ? 'ComfyUI Running'
        : state === 'error'
          ? 'ComfyUI Error'
          : 'ComfyUI Disconnected';

  const cls =
    state === 'connected'
      ? 'otg-conn otg-conn--ok'
      : state === 'busy'
        ? 'otg-conn otg-conn--busy'
        : 'otg-conn otg-conn--bad';

  const title =
    state === 'connected'
      ? `Connected to ${target || 'ComfyUI'}`
      : state === 'busy'
        ? `Running on ${target || 'ComfyUI'}`
        : state === 'error'
          ? error
          : `Not connected to ${target || 'ComfyUI'}`;

  return (
    <div className={cls} title={title} aria-live="polite">
      {label}
    </div>
  );
}
