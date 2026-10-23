"use client";
import { useCallback, useEffect, useState } from "react";
import AdminShell, { AdminBadge, adminStyles as styles } from "@/app/app/admin/AdminShell";
import AdminGpuControls from "@/app/app/components/AdminGpuControls";
type Service = { id: string; label: string; state: string; target?: string; status?: number | string; error?: string; ms?: number; version?: string | null };
type Health = { summary?: { ok: number; total: number; notConfigured: number; disabled: number; requiredFailures: number }; services: Service[]; checkedAt?: string };
export default function HealthClient() {
  const [data, setData] = useState<Health | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError("");
    try { const res = await fetch("/api/admin/health/services", { cache: "no-store", signal }); const result = await res.json(); if (!res.ok) throw Error(result.error || "Health check failed."); if (!signal?.aborted) setData(result); }
    catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Health check failed."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  return <AdminShell title="GPU / Services" description="Maintenance targets are identity-pinned. Busy workers are protected." actions={<button className={styles.button} disabled={busy} onClick={() => void load()}>{busy ? "Checking…" : "Refresh services"}</button>}>
    <section className={styles.grid} aria-label="GPU maintenance"><AdminGpuControls fixedTarget="3090" /><AdminGpuControls fixedTarget="5060ti" /></section>
    <h2 style={{ marginTop: 24 }}>Service health</h2>{error ? <p role="alert">{error}</p> : null}
    {data?.summary ? <p>{data.summary.ok}/{data.summary.total} configured, enabled services healthy. {data.summary.notConfigured} not configured · {data.summary.disabled} disabled. {data.summary.requiredFailures ? `${data.summary.requiredFailures} required service(s) need attention.` : ""}</p> : null}
    <p className={styles.muted}>HTTP health confirms reachability, not model initialization or generation schedulability. GPU worker readiness is shown separately above.</p>
    <section className={styles.grid}>{(data?.services || []).map(service => <article className={styles.card} key={service.id}><div className={styles.header}><strong>{service.label}</strong><AdminBadge status={service.state} /></div><p className={styles.muted}>Latency: {service.ms === undefined || ["DISABLED", "NOT CONFIGURED"].includes(service.state) ? "Not checked" : `${service.ms} ms`}</p><details className={styles.diagnostics}><summary>Diagnostics</summary>{service.target ? <p>Endpoint: {service.target}</p> : null}<p>HTTP / command status: {service.status ?? "Not checked"}</p>{service.version ? <p>{service.version}</p> : null}{service.error ? <p>{service.error}</p> : null}</details></article>)}</section>
    {data?.checkedAt ? <p className={styles.muted}>Checked {new Date(data.checkedAt).toLocaleString()}</p> : null}
  </AdminShell>;
}
