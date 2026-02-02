"use client";

import React, { useEffect, useMemo, useState } from "react";
import { withDeviceHeader } from "../studio/deviceHeader";


type QueueItem = { prompt_id: string };

type JobHistoryItem = {
  ts: number;
  ownerKey: string;
  deviceId: string | null;
  title: string | null;
  preset: string | null;
  prompts: string[] | null;
  positivePrompt: string | null;
  negativePrompt: string | null;
  seed: number | null;
  prompt_id: string | null;
  status: string;
  prompt_error: string | null;
  submitPayload: any | null;
};

function fmtTime(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts || "");
  }
}

function badgeClass(status: string) {
  const s = String(status || "").toLowerCase();
  if (s.includes("error") || s.includes("fail")) return "otg-badge otg-badgeError";
  if (s.includes("complete")) return "otg-badge otg-badgeOk";
  if (s.includes("running")) return "otg-badge otg-badgeWarn";
  if (s.includes("cancel")) return "otg-badge otg-badgeMuted";
  return "otg-badge";
}

export function HistoryClient() {
  const [queueRunning, setQueueRunning] = useState<QueueItem[]>([]);
  const [queuePending, setQueuePending] = useState<QueueItem[]>([]);
  const [items, setItems] = useState<JobHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyPromptId, setBusyPromptId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setErr(null);
      const [q, h] = await Promise.all([
        fetch("/api/jobs/queue", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/jobs/history?limit=60&withStatus=1", { cache: "no-store" }).then((r) => r.json()),
      ]);

      setQueueRunning(Array.isArray(q?.running) ? q.running : []);
      setQueuePending(Array.isArray(q?.pending) ? q.pending : []);
      setItems(Array.isArray(h?.items) ? h.items : []);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runningSet = useMemo(() => new Set(queueRunning.map((x) => x.prompt_id)), [queueRunning]);
  const pendingSet = useMemo(() => new Set(queuePending.map((x) => x.prompt_id)), [queuePending]);

  const doCancel = async (promptId: string) => {
    setBusyPromptId(promptId);
    try {
      const r = await fetch("/api/jobs/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({ promptId }),
      });
      if (!r.ok) throw new Error(await r.text());
    } catch (e: any) {
      alert(`Cancel failed: ${String(e?.message ?? e)}`);
    } finally {
      setBusyPromptId(null);
      refresh();
    }
  };

  const doRerun = async (payload: any) => {
    try {
      const r = await fetch("/api/comfy", { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(t || `HTTP ${r.status}`);
      }
      window.location.href = "/app";
    } catch (e: any) {
      alert(`Re-run failed: ${String(e?.message ?? e)}`);
    }
  };

  return (
    <div className="otg-shell">
      <header className="otg-header">
        <div className="otg-wrap">
          <div className="otg-headerRow">
            <div className="otg-brand">
              <img className="otg-logo" src="/otg-logo.png" alt="SLR Studios" />
              <div style={{ minWidth: 0 }}>
                <h1 className="otg-title otg-titleGrad">Queue & History</h1>
                <p className="otg-sub">Live queue + recent runs for your account/device.</p>
              </div>
            </div>

            <div className="otg-headerActions">
              <a href="/app" className="otg-btn otg-btnGhost" style={{ textDecoration: "none" }}>
                Back to Generator
              </a>
              <button type="button" className="otg-btn otg-btnGhost" onClick={refresh}>
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="otg-main">
        <div className="otg-wrap">
          <div className="otg-stack">
            {err ? (
              <div className="otg-alert otg-alertWarn">
                <div className="otg-alertTitle">Could not load queue/history</div>
                <div className="otg-alertBody">{err}</div>
              </div>
            ) : null}

            <section className="otg-card">
              <div className="otg-cardInner space-y-3">
                <div className="otg-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div className="otg-cardTitle">Live Queue</div>
                    <div className="otg-help">Running: {queueRunning.length} · Pending: {queuePending.length}</div>
                  </div>
                </div>

                {loading ? (
                  <div className="otg-help">Loading…</div>
                ) : queueRunning.length === 0 && queuePending.length === 0 ? (
                  <div className="otg-help">No active jobs in SLR Studios queue.</div>
                ) : (
                  <div className="space-y-2">
                    {queueRunning.length ? (
                      <div>
                        <div className="otg-label">Running</div>
                        <div className="space-y-2">
                          {queueRunning.map((x) => (
                            <div key={`run_${x.prompt_id}`} className="otg-row" style={{ justifyContent: "space-between", gap: 10 }}>
                              <div className="otg-help" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                                <span className="font-mono">{x.prompt_id}</span>
                              </div>
                              <button
                                type="button"
                                className="otg-btn otg-btnGhost"
                                disabled={busyPromptId === x.prompt_id}
                                onClick={() => doCancel(x.prompt_id)}
                              >
                                {busyPromptId === x.prompt_id ? "Canceling…" : "Cancel"}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {queuePending.length ? (
                      <div>
                        <div className="otg-label">Pending</div>
                        <div className="space-y-2">
                          {queuePending.map((x) => (
                            <div key={`pend_${x.prompt_id}`} className="otg-row" style={{ justifyContent: "space-between", gap: 10 }}>
                              <div className="otg-help" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                                <span className="font-mono">{x.prompt_id}</span>
                              </div>
                              <button
                                type="button"
                                className="otg-btn otg-btnGhost"
                                disabled={busyPromptId === x.prompt_id}
                                onClick={() => doCancel(x.prompt_id)}
                              >
                                {busyPromptId === x.prompt_id ? "Removing…" : "Remove"}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </section>

            <section className="otg-card">
              <div className="otg-cardInner space-y-3">
                <div className="otg-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div className="otg-cardTitle">History</div>
                    <div className="otg-help">Most recent submissions for your account/device.</div>
                  </div>
                  <a href="/app/gallery" className="otg-btn otg-btnGhost" style={{ textDecoration: "none" }}>
                    Open Gallery
                  </a>
                </div>

                {loading ? (
                  <div className="otg-help">Loading…</div>
                ) : items.length === 0 ? (
                  <div className="otg-help">No history yet. Generate something first.</div>
                ) : (
                  <div className="space-y-3">
                    {items.map((it, idx) => {
                      const pid = it.prompt_id || "";
                      const inQueue = pid ? runningSet.has(pid) || pendingSet.has(pid) : false;
                      const title = (it.title || "").trim() || (it.preset || "Untitled");
                      return (
                        <div key={`${it.ts}_${idx}`} className="otg-card" style={{ background: "rgba(0,0,0,0.12)" }}>
                          <div className="otg-cardInner space-y-2">
                            <div className="otg-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                              <div style={{ minWidth: 0 }}>
                                <div className="otg-row" style={{ gap: 8, flexWrap: "wrap" }}>
                                  <div className="otg-cardTitle" style={{ fontSize: 16 }}>{title}</div>
                                  <span className={badgeClass(inQueue ? "running" : it.status)}>
                                    {inQueue ? "in queue" : String(it.status)}
                                  </span>
                                </div>
                                <div className="otg-help">{fmtTime(it.ts)} · {it.preset || ""}</div>
                              </div>
                              <div className="otg-row" style={{ gap: 8, flexWrap: "wrap" }}>
                                {pid ? (
                                  <button
                                    type="button"
                                    className="otg-btn otg-btnGhost"
                                    disabled={busyPromptId === pid}
                                    onClick={() => doCancel(pid)}
                                  >
                                    {busyPromptId === pid ? "Canceling…" : "Cancel"}
                                  </button>
                                ) : null}
                                {it.submitPayload ? (
                                  <button
                                    type="button"
                                    className="otg-btn otg-btnPrimary"
                                    onClick={() => doRerun(it.submitPayload)}
                                  >
                                    Re-run
                                  </button>
                                ) : null}
                              </div>
                            </div>

                            {pid ? (
                              <div className="otg-help">
                                Prompt ID: <span className="font-mono">{pid}</span>
                              </div>
                            ) : null}

                            {it.prompt_error ? (
                              <div className="otg-alert otg-alertWarn">
                                <div className="otg-alertTitle">Error</div>
                                <div className="otg-alertBody">{it.prompt_error}</div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            <div className="otg-help">
              Cancel behavior: pending jobs are removed via <span className="font-mono">POST /queue</span>; running jobs use <span className="font-mono">POST /interrupt</span> (SLR Studios cannot always surgically cancel a specific running prompt).
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}