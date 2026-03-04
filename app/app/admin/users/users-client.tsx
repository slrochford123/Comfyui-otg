"use client";

import { useEffect, useMemo, useState } from "react";


type UserRow = { id: string; email: string; username: string | null; createdAt: string };
type ApiResponse =
  | { ok: true; count: number; users: UserRow[] }
  | { ok: false; error: string; detail?: string };

export default function AdminUsersClient() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<UserRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyResetId, setBusyResetId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/users", { credentials: "include", cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as ApiResponse;

      if (!r.ok || !j || (j as any).ok !== true) {
        setErr((j as any)?.error || "Not authorized");
        setData([]);
        return;
      }

      setData((j as any).users || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load users");
      setData([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data;
    return data.filter((u) => u.email.toLowerCase().includes(s) || (u.username || "").toLowerCase().includes(s));
  }, [q, data]);

  async function deleteUser(u: UserRow) {
    const ok = confirm(`Delete this account?\n\nEmail: ${u.email}\nUsername: ${u.username || "—"}\n\nThis cannot be undone.`);
    if (!ok) return;

    setBusyId(u.id);
    setErr(null);
    try {
      const r = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: u.id }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        setErr(j?.error || "Delete failed.");
        return;
      }
      await load();
    } catch (e: any) {
      setErr(e?.message || "Delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function resetUserState(u: UserRow) {
    const ok = confirm(
      `Reset this user's "currently running" state?\n\nEmail: ${u.email}\nUsername: ${u.username || "—"}\n\nThis unlocks Generate if they are stuck.`
    );
    if (!ok) return;

    setBusyResetId(u.id);
    setErr(null);
    try {
      const r = await fetch("/api/admin/reset-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: u.id, username: u.username }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        setErr(j?.error || "Reset failed.");
        return;
      }
      alert("Reset complete.");
    } catch (e: any) {
      setErr(e?.message || "Reset failed.");
    } finally {
      setBusyResetId(null);
    }
  }

  return (
  <div>
    <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
      <a
        href="/app"
        className="otg-authShowBtn"
        style={{ textDecoration: "none", padding: "10px 14px" }}
      >
        ← Back to App
      </a>
    </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input
          className="otg-authInput"
          placeholder="Search email or username…"
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

      <div className="otg-adminGrid">
  <div className="otg-adminRow otg-adminHead">
    <div className="otg-adminCell otg-adminEmail">Email</div>
    <div className="otg-adminCell otg-adminUser">Username</div>
    <div className="otg-adminCell otg-adminCreated">Created</div>
    <div className="otg-adminCell otg-adminActions">Actions</div>
  </div>

  {filtered.map((u) => (
    <div key={u.id} className="otg-adminRow">
      <div className="otg-adminCell otg-adminEmail">
        <div className="otg-adminLabel">Email</div>
        <div className="otg-adminValue">{u.email}</div>
      </div>

      <div className="otg-adminCell otg-adminUser">
        <div className="otg-adminLabel">Username</div>
        <div className="otg-adminValue">{u.username || "—"}</div>
      </div>

      <div className="otg-adminCell otg-adminCreated">
        <div className="otg-adminLabel">Created</div>
        <div className="otg-adminValue">
          {u.createdAt ? new Date(u.createdAt).toLocaleString() : "—"}
        </div>
      </div>

      <div className="otg-adminCell otg-adminActions">
        <button
          className="otg-authShowBtn"
          type="button"
          onClick={() => resetUserState(u)}
          disabled={busyResetId === u.id || !u.username}
          style={{ marginRight: 10, padding: "10px 14px" }}
          title={!u.username ? "User has no username; cannot reset state." : ""}
        >
          {busyResetId === u.id ? "Resetting…" : "Reset"}
        </button>
        <button
          className="otg-adminDeleteBtn"
          type="button"
          onClick={() => deleteUser(u)}
          disabled={busyId === u.id}
        >
          {busyId === u.id ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  ))}



        {!loading && !err && filtered.length === 0 ? (
          <div className="otg-authSub" style={{ marginTop: 10 }}>
            No users.
          </div>
        ) : null}
      </div>
    </div>
  );
}
