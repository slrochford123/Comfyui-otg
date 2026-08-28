"use client";

import * as React from "react";

type ViewKey = "front" | "back" | "left" | "right";

type ViewResult = {
  originalUrl: string;
  processedUrl: string;
  note: string;
  changed: boolean;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  stage?: string;
  detail?: unknown;
  modelUrl?: string;
  promptId?: string;
  endpoint?: string;
  views?: Record<ViewKey, ViewResult>;
};

const VIEW_ORDER: ViewKey[] = ["front", "back", "left", "right"];

function getOrCreateDeviceId() {
  if (typeof window === "undefined") return "desktop_default";
  const key = "otg_device_id";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
  } catch {}
  const next = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `dev_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  try { localStorage.setItem(key, next); } catch {}
  return next;
}

function Card(props: React.PropsWithChildren<{ title: string; subtitle?: string }>) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, background: "rgba(255,255,255,0.04)", padding: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{props.title}</div>
      {props.subtitle ? <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginBottom: 12 }}>{props.subtitle}</div> : null}
      {props.children}
    </div>
  );
}

export default function CharacterMvPage() {
  const [files, setFiles] = React.useState<Record<ViewKey, File | null>>({ front: null, back: null, left: null, right: null });
  const [previews, setPreviews] = React.useState<Record<ViewKey, string>>({ front: "", back: "", left: "", right: "" });
  const [removeBackground, setRemoveBackground] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("Upload front, back, left, and right character views. This phase is manual 4-view only.");
  const [result, setResult] = React.useState<ApiResponse | null>(null);

  React.useEffect(() => {
    const urls: Partial<Record<ViewKey, string>> = {};
    for (const key of VIEW_ORDER) {
      const file = files[key];
      urls[key] = file ? URL.createObjectURL(file) : "";
    }
    setPreviews((prev) => {
      for (const key of VIEW_ORDER) {
        if (prev[key]) {
          try { URL.revokeObjectURL(prev[key]); } catch {}
        }
      }
      return { front: urls.front || "", back: urls.back || "", left: urls.left || "", right: urls.right || "" };
    });
    return () => {
      for (const key of VIEW_ORDER) {
        if (urls[key]) {
          try { URL.revokeObjectURL(urls[key]!); } catch {}
        }
      }
    };
  }, [files]);

  const setFile = (key: ViewKey, file: File | null) => setFiles((prev) => ({ ...prev, [key]: file }));

  async function handleSubmit() {
    for (const key of VIEW_ORDER) {
      if (!files[key]) {
        setMessage(`Missing ${key} image.`);
        return;
      }
    }
    setBusy(true);
    setResult(null);
    setMessage("Preparing 4 views, removing background, and submitting to Trellis 2 multiview workflow...");
    try {
      const fd = new FormData();
      for (const key of VIEW_ORDER) fd.append(key, files[key] as File, (files[key] as File).name);
      fd.append("removeBackground", String(removeBackground));
      fd.append("squareSize", "1024");
      fd.append("pipelineType", "1024_cascade");
      fd.append("sparseStructureSteps", "12");
      fd.append("shapeSteps", "30");
      fd.append("textureSteps", "25");
      fd.append("maxNumTokens", "49152");
      fd.append("sparseStructureResolution", "32");
      fd.append("useTiledDecoder", "true");
      fd.append("sampler", "euler");

      const res = await fetch("/api/3d/generate-character-mv", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": getOrCreateDeviceId() },
        body: fd,
      });
      const text = await res.text();
      let json: ApiResponse | null = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { ok: false, error: text || `Request failed (${res.status})` }; }
      if (res.status === 401) {
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || text || `Character multiview failed (${res.status})`);
      }
      setResult(json);
      setMessage("Character multiview GLB generated.");
    } catch (e: any) {
      setMessage(e?.message || "Character multiview failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0b1020", color: "#fff", padding: 24 }}>
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gap: 16 }}>
        <Card title="Phase 1 — Character Multi-View Trellis 2" subtitle="Manual 4-view upload -> background removal -> Trellis 2 multiview mesh+texture -> textured GLB">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" checked={removeBackground} onChange={(e) => setRemoveBackground(e.target.checked)} />
              Remove background before Trellis
            </label>
            <button
              onClick={handleSubmit}
              disabled={busy}
              style={{ borderRadius: 999, border: "1px solid rgba(0,229,255,0.45)", background: "linear-gradient(90deg, rgba(124,58,237,0.45), rgba(34,211,238,0.25))", color: "#fff", padding: "10px 16px", fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 }}
            >
              {busy ? "Generating..." : "Generate textured GLB"}
            </button>
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 14 }}>{message}</div>
          </div>
          <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 13 }}>
            Use a full-body character with clear separation between limbs and torso. Keep the same character identity across all four views. Front/back/left/right should be square and centered.
          </div>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16 }}>
          {VIEW_ORDER.map((key) => (
            <Card key={key} title={key[0].toUpperCase() + key.slice(1)}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setFile(key, e.target.files?.[0] || null)}
                style={{ width: "100%", marginBottom: 12 }}
              />
              <div style={{ aspectRatio: "1 / 1", borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.06)", display: "grid", placeItems: "center" }}>
                {previews[key] ? <img src={previews[key]} alt={`${key} preview`} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 13 }}>No image</div>}
              </div>
            </Card>
          ))}
        </div>

        {result?.views ? (
          <Card title="Processed views actually sent to Trellis">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16 }}>
              {VIEW_ORDER.map((key) => {
                const view = result.views?.[key];
                if (!view) return null;
                return (
                  <div key={key} style={{ display: "grid", gap: 10 }}>
                    <div style={{ fontWeight: 700 }}>{key[0].toUpperCase() + key.slice(1)}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginBottom: 6 }}>Original</div>
                        <div style={{ aspectRatio: "1 / 1", borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
                          <img src={view.originalUrl} alt={`${key} original`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginBottom: 6 }}>Processed</div>
                        <div style={{ aspectRatio: "1 / 1", borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
                          <img src={view.processedUrl} alt={`${key} processed`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>{view.note}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}

        {result?.modelUrl ? (
          <Card title="Result">
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <a href={result.modelUrl} target="_blank" rel="noreferrer" style={{ color: "#7dd3fc", fontWeight: 700 }}>Open textured GLB</a>
              {result.promptId ? <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>Prompt ID: {result.promptId}</span> : null}
              {result.endpoint ? <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>Endpoint: {result.endpoint}</span> : null}
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
