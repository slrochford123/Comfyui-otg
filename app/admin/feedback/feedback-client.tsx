"use client";

import { useEffect, useMemo, useState } from "react";

type FeedbackItem = {
  createdAt: string;
  category?: string;
  page?: string;
  message: string;
};

type ApiResponse =
  | { ok: true; count: number; items: FeedbackItem[] }
  | { ok: false; error: string };

export default function AdminFeedbackClient() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/feedback", { credentials: "include", cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as ApiResponse;
      if (!r.ok || !j || (j as any).ok !== true) {
        setErr((j as any)?.error || "Not authorized");
        setItems([]);
        return;
      }
      setItems((j as any).items || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load feedback");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) => {
      const blob = `${x.category || ""} ${x.page || ""} ${x.message || ""}`.toLowerCase();
      return blob.includes(s);
    });
  }, [q, items]);

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <a href="/app" className="otg-authShowBtn" style={{ textDecoration: "none", padding: "10px 14px" }}>
          ← Back to App
        </a>
        <a
          href="/app/admin/users"
          className="otg-authShowBtn"
          style={{ textDecoration: "none", padding: "10px 14px" }}
        >
          Users
        </a>
        <a
          href="/app/admin/gallery"
          className="otg-authShowBtn"
          style={{ textDecoration: "none", padding: "10px 14px" }}
        >
          Gallery
        </a>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input
          className="otg-authInput"
          placeholder="Search category/page/message…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="otg-authShowBtn" onClick={load} type="button">
          Refresh
        </button>
      </div>

      {loading ? <div className="otg-authSub">Loading…</div> : null}
      {err ? <div className="otg-authErr">{err}</div> : null}

      <div style={{ display: "grid", gap: 12 }}>
        {filtered.map((x, idx) => (
          <div key={`${x.createdAt}-${idx}`} className="otg-card" style={{ padding: 14 }}>
            <div className="otg-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="otg-cardTitle" style={{ margin: 0 }}>
                  {x.category || "Feedback"}
                </div>
                <div className="otg-help" style={{ marginTop: 6 }}>
                  {x.createdAt ? new Date(x.createdAt).toLocaleString() : ""}
                  {x.page ? ` • ${x.page}` : ""}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 10, whiteSpace: "pre-wrap" }} className="otg-help">
              {x.message}
            </div>
          </div>
        ))}
      </div>

      {!loading && !err && filtered.length === 0 ? (
        <div className="otg-authSub" style={{ marginTop: 10 }}>
          No feedback.
        </div>
      ) : null}
    </div>
  );
}
