'use client';

import { useCallback, useEffect, useState } from 'react';

type ServiceHealth = {
  id: string;
  label: string;
  ok: boolean;
  status?: number | string;
  target?: string;
  error?: string;
  ms?: number;
  version?: string | null;
};

type HealthResponse = {
  ok: boolean;
  summary?: { ok: number; total: number };
  services?: ServiceHealth[];
  checkedAt?: string;
  error?: string;
};

export default function HealthClient() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/health/services', { cache: 'no-store', credentials: 'include' });
      const json = await res.json().catch(() => null) as HealthResponse | null;
      if (!res.ok || !json) throw new Error(json?.error || `Health check failed (${res.status})`);
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Health check failed.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main style={{ padding: 24, color: 'white', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Admin health</h1>
          <p style={{ opacity: 0.75, marginTop: 8 }}>
            {data?.summary ? `${data.summary.ok}/${data.summary.total} services healthy` : 'Checking services...'}
          </p>
        </div>
        <button type="button" onClick={load} disabled={busy}>
          {busy ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error ? <p role="alert" style={{ color: '#ffb4b4' }}>{error}</p> : null}
      {data?.checkedAt ? <p style={{ opacity: 0.65 }}>Last checked: {new Date(data.checkedAt).toLocaleString()}</p> : null}

      <section style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        {(data?.services || []).map((service) => (
          <article key={service.id} style={{ border: '1px solid rgba(255,255,255,.16)', borderRadius: 12, padding: 16, background: 'rgba(255,255,255,.06)' }}>
            <strong>{service.label}</strong>
            <div>Status: {service.ok ? 'OK' : 'DOWN'} {service.status !== undefined ? `(${service.status})` : ''}</div>
            {service.target ? <div style={{ opacity: 0.75 }}>Target: {service.target}</div> : null}
            {service.version ? <div style={{ opacity: 0.75 }}>Version: {service.version}</div> : null}
            {service.ms !== undefined ? <div style={{ opacity: 0.75 }}>Latency: {service.ms}ms</div> : null}
            {service.error ? <div style={{ color: '#ffb4b4' }}>{service.error}</div> : null}
          </article>
        ))}
      </section>
    </main>
  );
}
