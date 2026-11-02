"use client";
import { useCallback, useEffect, useState } from "react";
import AdminShell, { AdminBadge, adminStyles as styles } from "@/app/app/admin/AdminShell";
import AdminGpuControls from "@/app/app/components/AdminGpuControls";
type Service = { id: string; label: string; state: string; target?: string; status?: number | string; error?: string; ms?: number; version?: string | null };
type Health = { summary?: { ok: number; total: number; notConfigured: number; disabled: number; requiredFailures: number }; services: Service[]; checkedAt?: string;
  storage?:{available:boolean;freeBytes:number|null;totalBytes:number|null;ok?:boolean;warning?:string|null};
  build?:{buildVersion:string;releaseName?:string|null};audio?:{enabled:boolean;pythonReady:boolean;notes:string[]} };
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
    {data?.build&&<p>Build {data.build.buildVersion}{data.build.releaseName?` · ${data.build.releaseName}`:""}</p>}
    {data?.storage&&<article className={styles.card}><strong>Application storage</strong><p>{data.storage.available&&data.storage.freeBytes!==null?`${(data.storage.freeBytes/1024**3).toFixed(1)} GiB free`:'Storage check unavailable'}</p>{data.storage.ok===false||data.storage.warning?<p role="status">{data.storage.warning||'Insufficient storage reserve; new media operations are paused to protect existing files.'}</p>:null}<p className={styles.muted}>This volume only; remote GPU output disks require their own capacity check. Nothing is automatically deleted.</p></article>}
    {data?.audio&&<article className={styles.card}><strong>Unified Audio Editing</strong><p>{!data.audio.enabled?'Disabled on this deployment':!data.audio.pythonReady?'Runtime unavailable':'Runtime installed; model inference qualification is separate'}</p><details className={styles.diagnostics}><summary>Availability and model notes</summary>{data.audio.notes.map((note,i)=><p key={i}>{note}</p>)}</details></article>}
    <section className={styles.grid}>{(data?.services || []).map(service => <article className={styles.card} key={service.id}><div className={styles.header}><strong>{service.label}</strong><AdminBadge status={service.state} /></div><p className={styles.muted}>Latency: {service.ms === undefined || ["DISABLED", "NOT CONFIGURED"].includes(service.state) ? "Not checked" : `${service.ms} ms`}</p><details className={styles.diagnostics}><summary>Diagnostics</summary>{service.target ? <p>Endpoint: {service.target}</p> : null}<p>HTTP / command status: {service.status ?? "Not checked"}</p>{service.version ? <p>{service.version}</p> : null}{service.error ? <p>{service.error}</p> : null}</details></article>)}</section>
    {data?.checkedAt ? <p className={styles.muted}>Checked {new Date(data.checkedAt).toLocaleString()}</p> : null}
  </AdminShell>;
}
