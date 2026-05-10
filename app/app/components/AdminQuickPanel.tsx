import type { CSSProperties } from "react";

"use client";

export default function AdminQuickPanel() {
  const tileStyle: CSSProperties = {
    display: "block",
    textDecoration: "none",
    borderRadius: 22,
    padding: 16,
    background: "linear-gradient(180deg, rgba(25,22,44,.98), rgba(12,11,24,.98))",
    border: "1px solid rgba(140,110,255,.22)",
    boxShadow: "0 10px 32px rgba(0,0,0,.28)",
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
              <div className="otg-cardTitle" style={{ margin: 0 }}>Admin Gallery</div>
              <div className="otg-help" style={{ marginTop: 8 }}>
                Browse every image and video under the configured Comfy output root, including subfolders.
              </div>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
