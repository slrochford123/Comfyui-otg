"use client";
import { useEffect, useState } from "react";
import { adminStyles as styles } from "./AdminShell";
type Summary = Record<string, string>;
export default function AdminSummary() {
  const [status, setStatus] = useState<Summary>({ Application: "Checking…", "RTX 3090": "Checking…", "RTX 5060 Ti": "Checking…", Storage: "See Performance", "External services": "See GPU / Services" });
  useEffect(() => {
    const controller = new AbortController();
    const check = async (label: string, url: string, gpu = false) => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal }); const data = await response.json();
        const workers = gpu ? Object.values(data.status?.services || {}) as { http: string }[] : [];
        const value = !response.ok ? "Unavailable" : gpu ? workers.some(worker => worker.http === "busy") ? "Busy" : workers.length && workers.every(worker => ["ready", "not-applicable"].includes(worker.http)) ? "Worker ready" : "Not ready" : "Reachable";
        if (!controller.signal.aborted) setStatus(previous => ({ ...previous, [label]: value }));
      } catch { if (!controller.signal.aborted) setStatus(previous => ({ ...previous, [label]: "Unavailable" })); }
    };
    const services = async () => {
      try {
        const response = await fetch("/api/admin/health/services", { cache: "no-store", signal: controller.signal }); const data = await response.json();
        if (!response.ok) throw Error();
        if (!controller.signal.aborted) setStatus(previous => ({ ...previous, Storage: data.storage?.available ? `${(data.storage.freeBytes / 1024 ** 3).toFixed(1)} GB free` : "Unavailable", "External services": data.summary ? `${data.summary.ok}/${data.summary.total} configured services healthy` : "Unavailable" }));
      } catch { if (!controller.signal.aborted) setStatus(previous => ({ ...previous, Storage: "Not verified", "External services": "Unavailable" })); }
    };
    void Promise.all([check("Application", "/api/healthz"), check("RTX 3090", "/api/admin/gpu-controls?target=3090", true), check("RTX 5060 Ti", "/api/admin/gpu-controls?target=5060ti", true), services()]);
    return () => controller.abort();
  }, []);
  return <section className={styles.grid} aria-label="Status summary" style={{ marginBottom: 18 }}>{Object.entries(status).map(([label, value]) => <div className={styles.card} key={label}><strong>{label}</strong><p className={styles.muted}>{value}</p></div>)}</section>;
}
