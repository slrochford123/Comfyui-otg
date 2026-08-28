"use client";

import { useCallback, useEffect, useState } from "react";

type DirStats = {
  path: string;
  exists: boolean;
  files: number;
  dirs: number;
  bytes: number;
  ms: number;
};

type PerfResponse = {
  ok: boolean;
  checkedAt?: string;
  ms?: number;
  node?: string;
  env?: string;
  dataRoot?: string;
  dirs?: Record<string, DirStats>;
  totals?: Record<string, string | number>;
  routeCache?: { routeFiles: number; noStoreMentions: number; cacheableMentions: number };
  dependencies?: Record<string, string | null>;
  recommendations?: string[];
  error?: string;
};

const cardStyle = {
  border: "1px solid rgba(255,255,255,.14)",
  borderRadius: 14,
  padding: 16,
  background: "rgba(255,255,255,.06)",
} as const;

function formatNumber(value: number | undefined) {
  return typeof value === "number" ? value.toLocaleString() : "0";
}

export default function PerformanceClient() {
  const [data, setData] = useState<PerfResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/performance", { cache: "no-store", credentials: "include" });
      const json = (await res.json().catch(() => null)) as PerfResponse | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Performance check failed (${res.status})`);
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Performance check failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirs = data?.dirs || {};
  const dirEntries = Object.entries(dirs);

  return (
    <main style={{ minHeight: "100vh", padding: 24, color: "white", fontFamily: "system-ui, sans-serif", background: "#05060b" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Admin Performance</h1>
          <p style={{ opacity: 0.72, marginTop: 8 }}>
            {data?.checkedAt ? `Last checked ${new Date(data.checkedAt).toLocaleString()}` : "Checking app performance snapshot..."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/app/admin" style={{ color: "white", textDecoration: "none", border: "1px solid rgba(255,255,255,.18)", borderRadius: 999, padding: "10px 14px" }}>Admin</a>
          <a href="/app/admin/health" style={{ color: "white", textDecoration: "none", border: "1px solid rgba(255,255,255,.18)", borderRadius: 999, padding: "10px 14px" }}>Health</a>
          <button type="button" onClick={() => void load()} disabled={busy} style={{ borderRadius: 999, padding: "10px 14px" }}>
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {error ? <p role="alert" style={{ color: "#ffb4b4" }}>{error}</p> : null}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 24 }}>
        <article style={cardStyle}>
          <div style={{ opacity: 0.6, fontSize: 12, textTransform: "uppercase", letterSpacing: ".12em" }}>Media Size</div>
          <strong style={{ display: "block", marginTop: 8, fontSize: 24 }}>{data?.totals?.mediaSize || "0 B"}</strong>
        </article>
        <article style={cardStyle}>
          <div style={{ opacity: 0.6, fontSize: 12, textTransform: "uppercase", letterSpacing: ".12em" }}>Thumbnails</div>
          <strong style={{ display: "block", marginTop: 8, fontSize: 24 }}>{formatNumber(Number(data?.totals?.thumbnailFiles || 0))}</strong>
          <div style={{ opacity: 0.65 }}>{data?.totals?.thumbnailSize || "0 B"}</div>
        </article>
        <article style={cardStyle}>
          <div style={{ opacity: 0.6, fontSize: 12, textTransform: "uppercase", letterSpacing: ".12em" }}>API Route Files</div>
          <strong style={{ display: "block", marginTop: 8, fontSize: 24 }}>{formatNumber(data?.routeCache?.routeFiles)}</strong>
          <div style={{ opacity: 0.65 }}>{formatNumber(data?.routeCache?.cacheableMentions)} cache-aware / {formatNumber(data?.routeCache?.noStoreMentions)} no-store</div>
        </article>
        <article style={cardStyle}>
          <div style={{ opacity: 0.6, fontSize: 12, textTransform: "uppercase", letterSpacing: ".12em" }}>Snapshot Time</div>
          <strong style={{ display: "block", marginTop: 8, fontSize: 24 }}>{formatNumber(data?.ms)}ms</strong>
          <div style={{ opacity: 0.65 }}>{data?.node || ""}</div>
        </article>
      </section>

      <section style={{ display: "grid", gap: 12, marginTop: 18 }}>
        <h2 style={{ marginBottom: 0 }}>Storage</h2>
        {dirEntries.map(([key, dir]) => (
          <article key={key} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <strong>{key}</strong>
              <span style={{ color: dir.exists ? "#b7f7c0" : "#ffcf99" }}>{dir.exists ? "present" : "missing"}</span>
            </div>
            <div style={{ opacity: 0.68, marginTop: 6, wordBreak: "break-all" }}>{dir.path}</div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, opacity: 0.82 }}>
              <span>{formatNumber(dir.files)} files</span>
              <span>{formatNumber(dir.dirs)} folders</span>
              <span>{formatNumber(dir.bytes)} bytes</span>
              <span>{formatNumber(dir.ms)}ms scan</span>
            </div>
          </article>
        ))}
      </section>

      <section style={{ display: "grid", gap: 12, marginTop: 18 }}>
        <h2 style={{ marginBottom: 0 }}>Recommendations</h2>
        {(data?.recommendations || []).map((item) => (
          <div key={item} style={cardStyle}>{item}</div>
        ))}
      </section>
    </main>
  );
}
