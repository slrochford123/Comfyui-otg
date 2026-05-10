"use client";

import { useCallback, useEffect, useState } from "react";

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

const cardStyle = {
  border: "1px solid rgba(255,255,255,.14)",
  borderRadius: 14,
  padding: 16,
  background: "rgba(255,255,255,.06)",
} as const;

export default function HealthClient() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/health/services", { cache: "no-store", credentials: "include" });
      const json = (await res.json().catch(() => null)) as HealthResponse | null;
      if (!res.ok || !json) throw new Error(json?.error || `Health check failed (${res.status})`);
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Health check failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main style={{ minHeight: "100vh", padding: 24, color: "white", fontFamily: "system-ui, sans-serif", background: "#05060b" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Admin Health</h1>
          <p style={{ opacity: 0.75, marginTop: 8 }}>
            {data?.summary ? `${data.summary.ok}/${data.summary.total} services healthy` : "Checking services..."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/app/admin" style={{ color: "white", textDecoration: "none", border: "1px solid rgba(255,255,255,.18)", borderRadius: 999, padding: "10px 14px" }}>Admin</a>
          <a href="/app/admin/performance" style={{ color: "white", textDecoration: "none", border: "1px solid rgba(255,255,255,.18)", borderRadius: 999, padding: "10px 14px" }}>Performance</a>
          <button type="button" onClick={() => void load()} disabled={busy} style={{ borderRadius: 999, padding: "10px 14px" }}>
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {error ? <p role="alert" style={{ color: "#ffb4b4" }}>{error}</p> : null}
      {data?.checkedAt ? <p style={{ opacity: 0.65 }}>Last checked: {new Date(data.checkedAt).toLocaleString()}</p> : null}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 24 }}>
        {(data?.services || []).map((service) => (
          <article key={service.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <strong>{service.label}</strong>
              <span style={{ color: service.ok ? "#b7f7c0" : "#ffb4b4" }}>{service.ok ? "OK" : "DOWN"}</span>
            </div>
            <div style={{ opacity: 0.75, marginTop: 8 }}>Status: {service.status ?? "unknown"}</div>
            {service.target ? <div style={{ opacity: 0.75, wordBreak: "break-all" }}>Target: {service.target}</div> : null}
            {service.version ? <div style={{ opacity: 0.75 }}>Version: {service.version}</div> : null}
            {service.ms !== undefined ? <div style={{ opacity: 0.75 }}>Latency: {service.ms}ms</div> : null}
            {service.error ? <div style={{ color: "#ffb4b4", marginTop: 8 }}>{service.error}</div> : null}
          </article>
        ))}
      </section>
    </main>
  );
}
