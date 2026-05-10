import type { CSSProperties } from "react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const tileStyle: CSSProperties = {
  display: "block",
  textDecoration: "none",
  borderRadius: 22,
  padding: 18,
  background: "linear-gradient(180deg, rgba(25,22,44,.98), rgba(12,11,24,.98))",
  border: "1px solid rgba(140,110,255,.22)",
  boxShadow: "0 10px 32px rgba(0,0,0,.28)",
};

export default function AdminRootPage() {
  return (
    <main className="otg-authPage">
      <div className="otg-authBg" />
      <section className="otg-authCard2" style={{ maxWidth: 980 }}>
        <h1 className="otg-authTitle" style={{ marginBottom: 6 }}>Admin Panel</h1>
        <p className="otg-authSub" style={{ marginBottom: 16 }}>
          Quick access to users, gallery operations, service health, and performance checks.
        </p>

        <div style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="/app" className="otg-authShowBtn" style={{ textDecoration: "none", padding: "10px 14px" }}>
            Back to App
          </a>
          <a href="/app/admin/users" className="otg-authShowBtn" style={{ textDecoration: "none", padding: "10px 14px" }}>
            Users
          </a>
          <a href="/app/admin/gallery" className="otg-authShowBtn" style={{ textDecoration: "none", padding: "10px 14px" }}>
            Gallery
          </a>
          <a href="/app/admin/health" className="otg-authShowBtn" style={{ textDecoration: "none", padding: "10px 14px" }}>
            Health
          </a>
          <a href="/app/admin/performance" className="otg-authShowBtn" style={{ textDecoration: "none", padding: "10px 14px" }}>
            Performance
          </a>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          <a href="/app/admin/users" style={tileStyle}>
            <div className="otg-cardTitle" style={{ margin: 0 }}>Admin Users</div>
            <div className="otg-help" style={{ marginTop: 8 }}>
              Delete users, inspect accounts, and reset stuck generation state.
            </div>
          </a>

          <a href="/app/admin/gallery" style={tileStyle}>
            <div className="otg-cardTitle" style={{ margin: 0 }}>Admin Gallery</div>
            <div className="otg-help" style={{ marginTop: 8 }}>
              Browse all images and videos from the configured Comfy output root, including nested subfolders.
            </div>
          </a>

          <a href="/app/admin/health" style={tileStyle}>
            <div className="otg-cardTitle" style={{ margin: 0 }}>Health Center</div>
            <div className="otg-help" style={{ marginTop: 8 }}>
              Check Comfy targets, ffmpeg, IndexTTS2, Ollama, Hunyuan, and background removal services.
            </div>
          </a>

          <a href="/app/admin/performance" style={tileStyle}>
            <div className="otg-cardTitle" style={{ margin: 0 }}>Performance Center</div>
            <div className="otg-help" style={{ marginTop: 8 }}>
              Inspect storage size, thumbnail cache, route cache coverage, and dependency status.
            </div>
          </a>
        </div>
      </section>
    </main>
  );
}
