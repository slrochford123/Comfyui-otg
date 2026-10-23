"use client";
import { useCallback, useEffect, useState } from "react";
import AdminShell, { adminStyles as styles } from "@/app/app/admin/AdminShell";
type Dir = { path: string; exists: boolean; files: number; dirs: number; bytes: number; ms: number };
type Snapshot = { checkedAt: string; ms: number; node: string; env: string; dirs: Record<string, Dir>; totals: Record<string, string | number>; routeCache: { routeFiles: number; cacheableMentions: number; noStoreMentions: number }; recommendations: string[] };
export function storageState(key: string, dir: Dir) { return dir.exists ? dir.files ? "Available" : "Empty" : ["dataRoot", "nextStatic"].includes(key) ? "Missing — required" : "Not initialized"; }
export default function PerformanceClient() {
  const [data, setData] = useState<Snapshot | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError("");
    try { const res = await fetch("/api/admin/performance", { cache: "no-store", signal }); const result = await res.json(); if (!res.ok || !result.ok) throw Error(result.error || "Performance snapshot unavailable."); if (!signal?.aborted) setData(result); }
    catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Performance snapshot unavailable."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  return <AdminShell title="Performance" description="Storage and runtime snapshot" actions={<button className={styles.button} disabled={busy} onClick={() => void load()}>{busy ? "Refreshing…" : "Refresh"}</button>}>
    {error ? <p role="alert">{error}</p> : null}<h2>Overview</h2><section className={styles.grid}>{[["Media storage", data?.totals?.mediaSize || "0 B"], ["Thumbnails", `${data?.totals?.thumbnailFiles || 0} · ${data?.totals?.thumbnailSize || "0 B"}`], ["Snapshot", data ? `${data.ms} ms` : "Checking…"]].map(([label, value]) => <article className={styles.card} key={label}><strong>{label}</strong><p>{value}</p></article>)}</section>
    <h2 style={{ marginTop: 24 }}>Storage</h2><section className={styles.grid}>{Object.entries(data?.dirs || {}).map(([key, dir]) => <article key={key} className={styles.card}><strong>{key.replace(/([a-z])([A-Z])/g, "$1 $2")}</strong><p className={styles.muted}>{storageState(key, dir)} · {dir.files.toLocaleString()} files · {(dir.bytes / 1024 ** 2).toFixed(1)} MB</p><details className={styles.diagnostics}><summary>Storage diagnostics</summary><p>{dir.path}</p><p>{dir.dirs} folders · {dir.ms} ms scan</p></details></article>)}</section>
    <section className={styles.grid} style={{ marginTop: 18 }}><article className={styles.card}><h2>Cache</h2><p>{data?.routeCache?.cacheableMentions || 0} cache-aware / {data?.routeCache?.noStoreMentions || 0} no-store route definitions.</p><p className={styles.muted}>Source declarations, not a live cache hit-rate measurement.</p></article><article className={styles.card}><h2>Runtime</h2><p>Node {data?.node || "Checking…"} · {data?.env}</p></article></section>
    <h2 style={{ marginTop: 24 }}>Recommendations</h2>{(data?.recommendations || []).map(item => <p key={item} className={styles.card}>{item}</p>)}
    <details className={styles.diagnostics}><summary>Advanced diagnostics</summary><p>Snapshot: {data?.checkedAt ? new Date(data.checkedAt).toLocaleString() : "Not available"}</p><p>API route definitions inspected: {data?.routeCache?.routeFiles || 0}</p></details>
  </AdminShell>;
}
