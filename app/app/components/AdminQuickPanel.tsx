"use client";

import type { CSSProperties } from "react";

import H3LoraAdminPanel from "./H3LoraAdminPanel";

export default function AdminQuickPanel() {
  const tileStyle: CSSProperties = {
    display: "block",
    textDecoration: "none",
    borderRadius: 22,
    padding: 16,
    background: "var(--color-card)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    boxShadow: "var(--color-shadow)",
  };

  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="otg-card">
        <div className="otg-cardTitle">Admin</div>
        <div className="otg-cardBody">
          <div className="otg-help" style={{ marginTop: 0 }}>
            Quick access to admin-only tools.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 14 }}>
            <a href="/app/admin/users" style={tileStyle}>
              <div className="otg-cardTitle" style={{ margin: 0 }}>Admin Users</div>
              <div className="otg-help" style={{ marginTop: 8 }}>
                View accounts, delete users, and reset stuck generation state.
              </div>
            </a>
            <a href="/app/admin/gallery" style={tileStyle}>
              <div className="otg-cardTitle" style={{ margin: 0 }}>Full Gallery</div>
              <div className="otg-help" style={{ marginTop: 8 }}>
                Browse all supported images and videos from both TEST ComfyUI output filesystems.
              </div>
            </a>
            <a href="/app/admin/openai-billing" style={tileStyle}>
              <div className="otg-cardTitle" style={{ margin: 0 }}>OpenAI Billing</div>
              <div className="otg-help" style={{ marginTop: 8 }}>
                View usage, credits, estimates, limits, and official billing sync status.
              </div>
            </a>
          </div>
          <H3LoraAdminPanel />
        </div>
      </div>
    </div>
  );
}
