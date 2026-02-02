"use client";

import React from "react";
import { authHeaders } from "@/lib/authClient";

type Props = {
  name: string;
  onDeleted?: () => void | Promise<void>;
};

export default function GalleryItemActions({ name, onDeleted }: Props) {
  async function onDownload() {
    // Uses the existing gallery file endpoint
    const a = document.createElement("a");
    a.href = `/api/gallery/file?name=${encodeURIComponent(name)}&download=1`;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function onDelete() {
    if (!confirm(`Delete ${name}?`)) return;

    const res = await fetch(`/api/gallery/delete?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: authHeaders(),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      alert(`Delete failed: ${res.status} ${t}`);
      return;
    }

    await onDeleted?.();
  }

  const btn: React.CSSProperties = {
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.10)",
    cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button title="Download" onClick={onDownload} style={btn} aria-label="Download">
        ⬇️
      </button>
      <button title="Delete" onClick={onDelete} style={btn} aria-label="Delete">
        🗑️
      </button>
    </div>
  );
}
