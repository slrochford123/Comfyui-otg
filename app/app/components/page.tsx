"use client";

import * as React from "react";
type AnglesTab = "camera" | "mesh" | "model" | "trellis";
type Preset = { id: string; label: string; horizontal: number; vertical: number; zoom: number };

const PRESETS: Preset[] = [
  { id: "front", label: "Front", horizontal: 0, vertical: 0, zoom: 0 },
  { id: "threeq_left", label: "3/4 Left", horizontal: -45, vertical: 0, zoom: 0 },
  { id: "threeq_right", label: "3/4 Right", horizontal: 45, vertical: 0, zoom: 0 },
  { id: "profile_left", label: "Profile Left", horizontal: -90, vertical: 0, zoom: 0 },
  { id: "profile_right", label: "Profile Right", horizontal: 90, vertical: 0, zoom: 0 },
  { id: "behind", label: "Behind", horizontal: 180, vertical: 0, zoom: 0 },
  { id: "high", label: "High", horizontal: 0, vertical: 25, zoom: 0 },
  { id: "low", label: "Low", horizontal: 0, vertical: -20, zoom: 0 },
  { id: "wide", label: "Wide", horizontal: 0, vertical: 0, zoom: -2 },
  { id: "tight", label: "Tight", horizontal: 0, vertical: 0, zoom: 2 },
];

const TAB_HELP: Record<AnglesTab, string> = {
  camera: "Default camera-angle workflow. Upload an image, pick a framing preset, then submit to the Angles workflow.",
  mesh: "3D Mesh sends the image to Hunyuan 3D v2.1 on 100.109.254.63:8188 and returns a GLB mesh preview.",
  model: "3D Model sends the image to SPAR3D on 100.109.254.63:7861 and returns the generated 3D model file.",
  trellis: "Trellis 2 sends the image to 100.109.254.63:8188, runs the textured-shape workflow, and returns a textured GLB.",
};

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
  try {
    localStorage.setItem(key, next);
  } catch {}
  return next;
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function mapHorizontalDeg(h: number) {
  const v = Math.round(h);
  return ((v % 360) + 360) % 360;
}
function mapVerticalDeg(v: number) {
  const vv = Math.round(v);
  return ((vv % 360) + 360) % 360;
}
function mapZoom(z: number) {
  return clamp(5 + z, 1, 10);
}
function canPreviewInModelViewer(url: string) {
  return /\.(glb|gltf)(?:$|\?)/i.test(url);
}
function modelExtFromUrl(url: string) {
  const match = url.match(/\.([a-z0-9]+)(?:$|\?)/i);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function PillButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  const { active = false, style, children, ...rest } = props;
  return (
    <button
      {...rest}
      style={{
        borderRadius: 999,
        border: active ? "1px solid rgba(0,229,255,0.55)" : "1px solid rgba(255,255,255,0.12)",
        background: active ? "linear-gradient(90deg, rgba(124,58,237,0.35), rgba(34,211,238,0.25))" : "rgba(255,255,255,0.05)",
        color: "#fff",
        padding: "10px 14px",
        fontWeight: 600,
        cursor: "pointer",
        opacity: rest.disabled ? 0.55 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export default function AnglesPage() {
  const [mvReady, setMvReady] = React.useState(false);
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await import("@google/model-viewer");
        if (mounted) setMvReady(true);
      } catch {
        if (mounted) setMvReady(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const [activeTab, setActiveTab] = React.useState<AnglesTab>("camera");
  const [file, setFile] = React.useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState("");
  const [horizontal, setHorizontal] = React.useState(0);
  const [vertical, setVertical] = React.useState(0);
  const [zoom, setZoom] = React.useState(0);
  const [cameraBusy, setCameraBusy] = React.useState(false);
  const [cameraMsg, setCameraMsg] = React.useState("");

  const [removeBackground3d, setRemoveBackground3d] = React.useState(true);
  const [meshBusy, setMeshBusy] = React.useState(false);
  const [meshMsg, setMeshMsg] = React.useState("");
  const [meshModelUrl, setMeshModelUrl] = React.useState("");

  const [modelBusy, setModelBusy] = React.useState(false);
  const [modelMsg, setModelMsg] = React.useState("");
  const [modelUrl, setModelUrl] = React.useState("");
  const [modelPreviewSupported, setModelPreviewSupported] = React.useState(false);

  const [trellisBusy, setTrellisBusy] = React.useState(false);
  const [trellisMsg, setTrellisMsg] = React.useState("");
  const [trellisUrl, setTrellisUrl] = React.useState("");

  React.useEffect(() => {
    if (!file) {
      if (imagePreviewUrl) {
        try { URL.revokeObjectURL(imagePreviewUrl); } catch {}
      }
      setImagePreviewUrl("");
      setMeshModelUrl("");
      setModelUrl("");
      setTrellisUrl("");
      setMeshMsg("");
      setModelMsg("");
      setTrellisMsg("");
      return;
    }
    const next = URL.createObjectURL(file);
    setImagePreviewUrl(next);
    return () => {
      try { URL.revokeObjectURL(next); } catch {}
    };
  }, [file, imagePreviewUrl]);

  const applyPreset = (p: Preset) => {
    setHorizontal(p.horizontal);
    setVertical(p.vertical);
    setZoom(p.zoom);
  };

  const handleCameraCreate = async () => {
    if (!file) {
      setCameraMsg("Please upload an image first.");
      return;
    }
    setCameraBusy(true);
    setCameraMsg("Submitting to the Angles camera workflow...");
    try {
      const fd = new FormData();
      fd.append("workflowId", "presets/angles");
      fd.append("prompt", "");
      fd.append("negativePrompt", "");
      fd.append("imageA", file, file.name);
      fd.append("angleHorizontal", String(mapHorizontalDeg(horizontal)));
      fd.append("angleVertical", String(mapVerticalDeg(vertical)));
      fd.append("angleZoom", String(mapZoom(zoom)));
      const res = await fetch("/api/comfy", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": getOrCreateDeviceId() },
        body: fd,
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (res.status === 401) {
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok) throw new Error(json?.error || json?.detail || text || `Camera create failed (${res.status})`);
      setCameraMsg("Submitted. The output should appear in Gallery when the workflow finishes.");
    } catch (e: any) {
      setCameraMsg(e?.message || "Camera create failed.");
    } finally {
      setCameraBusy(false);
    }
  };

  const handleMeshGenerate = async () => {
    if (!file) {
      setMeshMsg("Please upload an image first.");
      return;
    }
    setMeshBusy(true);
    setMeshModelUrl("");
    setMeshMsg(removeBackground3d ? "Removing background, then sending to Hunyuan 3D v2.1..." : "Sending original image to Hunyuan 3D v2.1...");
    try {
      const fd = new FormData();
      fd.append("image", file, file.name);
      fd.append("removeBackground", String(removeBackground3d));
      const res = await fetch("/api/angles/preview-3d", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": getOrCreateDeviceId() },
        body: fd,
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (res.status === 401) {
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok || !json?.ok) throw new Error(json?.error || text || `3D mesh failed (${res.status})`);
      setMeshModelUrl(String(json.modelUrl || ""));
      setMeshMsg(json.preprocess ? `Mesh ready. ${json.preprocess}` : "Mesh ready.");
    } catch (e: any) {
      setMeshMsg(e?.message || "3D mesh failed.");
    } finally {
      setMeshBusy(false);
    }
  };

  const handleModelGenerate = async () => {
    if (!file) {
      setModelMsg("Please upload an image first.");
      return;
    }
    setModelBusy(true);
    setModelUrl("");
    setModelPreviewSupported(false);
    setModelMsg(removeBackground3d ? "Removing background, then sending to SPAR3D..." : "Sending original image to SPAR3D...");
    try {
      const fd = new FormData();
      fd.append("image", file, file.name);
      fd.append("removeBackground", String(removeBackground3d));
      const res = await fetch("/api/angles/model-3d", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": getOrCreateDeviceId() },
        body: fd,
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (res.status === 401) {
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok || !json?.ok) throw new Error(json?.error || text || `3D model failed (${res.status})`);
      setModelUrl(String(json.modelUrl || ""));
      setModelPreviewSupported(Boolean(json.previewSupported));
      setModelMsg(json.preprocess ? `3D model ready. ${json.preprocess}` : "3D model ready.");
    } catch (e: any) {
      setModelMsg(e?.message || "3D model failed.");
    } finally {
      setModelBusy(false);
    }
  };

  const handleTrellisGenerate = async () => {
    if (!file) {
      setTrellisMsg("Please upload an image first.");
      return;
    }
    setTrellisBusy(true);
    setTrellisUrl("");
    setTrellisMsg(removeBackground3d ? "Removing background, then sending to Trellis 2..." : "Sending original image to Trellis 2...");
    try {
      const fd = new FormData();
      fd.append("image", file, file.name);
      fd.append("removeBackground", String(removeBackground3d));
      const res = await fetch("/api/angles/trellis-3d", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": getOrCreateDeviceId() },
        body: fd,
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (res.status === 401) {
        window.location.href = "/login?reason=session";
        return;
      }
      if (!res.ok || !json?.ok) throw new Error(json?.error || text || `Trellis 2 failed (${res.status})`);
      setTrellisUrl(String(json.modelUrl || ""));
      setTrellisMsg(json.preprocess ? `Trellis 2 ready. ${json.preprocess}` : "Trellis 2 ready.");
    } catch (e: any) {
      setTrellisMsg(e?.message || "Trellis 2 failed.");
    } finally {
      setTrellisBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", padding: 18, color: "#fff", background: "#05060c" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 16 }}>
        <div style={{ padding: 18, borderRadius: 18, background: "rgba(12,12,20,0.72)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 0.2 }}>Angles</div>
              <div style={{ color: "rgba(255,255,255,0.72)", marginTop: 6 }}>
                Camera controls by default, plus 3D Mesh, 3D Model, and Trellis 2 using your TEST backends.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <PillButton active={activeTab === "camera"} onClick={() => setActiveTab("camera")}>Camera</PillButton>
              <PillButton active={activeTab === "mesh"} onClick={() => setActiveTab("mesh")}>3D Mesh</PillButton>
              <PillButton active={activeTab === "model"} onClick={() => setActiveTab("model")}>3D Model</PillButton>
              <PillButton active={activeTab === "trellis"} onClick={() => setActiveTab("trellis")}>Trellis 2</PillButton>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "rgba(255,255,255,0.72)" }}>{TAB_HELP[activeTab]}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ padding: 16, borderRadius: 18, background: "rgba(12,12,20,0.72)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Input Image</div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ width: "100%", color: "#fff" }}
              />
              <div style={{ marginTop: 12, borderRadius: 14, overflow: "hidden", minHeight: 240, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", display: "grid", placeItems: "center" }}>
                {imagePreviewUrl ? (
                  <img src={imagePreviewUrl} alt="Angles input preview" style={{ width: "100%", display: "block", objectFit: "contain", maxHeight: 420 }} />
                ) : (
                  <div style={{ color: "rgba(255,255,255,0.55)", padding: 24, textAlign: "center" }}>Upload a picture to begin.</div>
                )}
              </div>
              {activeTab !== "camera" && (
                <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, fontSize: 14 }}>
                  <input type="checkbox" checked={removeBackground3d} onChange={(e) => setRemoveBackground3d(e.target.checked)} />
                  <span>Remove Background before 3D</span>
                </label>
              )}
              {activeTab !== "camera" && (
                <div style={{ marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.62)" }}>
                  Best for single-subject images with a clean background. The original upload is kept unchanged.
                </div>
              )}
            </div>

            <div style={{ padding: 16, borderRadius: 18, background: "rgba(12,12,20,0.72)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Camera Controls</div>
              <div style={{ display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.72)" }}>Horizontal: {horizontal}Â°</span>
                  <input type="range" min={-180} max={180} step={1} value={horizontal} onChange={(e) => setHorizontal(Number(e.target.value))} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.72)" }}>Vertical: {vertical}Â°</span>
                  <input type="range" min={-30} max={60} step={1} value={vertical} onChange={(e) => setVertical(Number(e.target.value))} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.72)" }}>Zoom: {zoom}</span>
                  <input type="range" min={-5} max={5} step={1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                {PRESETS.map((preset) => (
                  <PillButton key={preset.id} onClick={() => applyPreset(preset)}>{preset.label}</PillButton>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ padding: 16, borderRadius: 18, background: "rgba(12,12,20,0.72)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {activeTab === "camera"
                    ? "Camera Workflow"
                    : activeTab === "mesh"
                      ? "3D Mesh Preview"
                      : activeTab === "model"
                        ? "3D Model Result"
                        : "Trellis 2 Result"}
                </div>
                {activeTab === "mesh" && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>Endpoint: 100.109.254.63:8188</div>}
                {activeTab === "model" && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>Endpoint: 100.109.254.63:7861</div>}
                {activeTab === "trellis" && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>Endpoint: 100.109.254.63:8188</div>}
              </div>

              {activeTab === "camera" && (
                <>
                  <div style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.72)" }}>
                    This submits the current image and camera settings into the Angles preset workflow and leaves the result in Gallery.
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                    <PillButton onClick={handleCameraCreate} disabled={cameraBusy}>{cameraBusy ? "Submitting..." : "Create Angle"}</PillButton>
                  </div>
                  <div style={{ marginTop: 12, minHeight: 22, color: cameraMsg ? "#a7f3d0" : "rgba(255,255,255,0.6)" }}>{cameraMsg}</div>
                </>
              )}

              {activeTab === "mesh" && (
                <>
                  <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                    <PillButton onClick={handleMeshGenerate} disabled={meshBusy}>{meshBusy ? "Working..." : "Generate 3D Mesh"}</PillButton>
                    {meshModelUrl && <a href={meshModelUrl} style={{ color: "#67e8f9", alignSelf: "center" }}>Download GLB</a>}
                  </div>
                  <div style={{ marginTop: 12, minHeight: 22, color: meshMsg ? "#a7f3d0" : "rgba(255,255,255,0.6)" }}>{meshMsg}</div>
                  <div style={{ marginTop: 14, borderRadius: 14, overflow: "hidden", minHeight: 420, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.08)", display: "grid", placeItems: "center" }}>
                    {meshModelUrl && mvReady && canPreviewInModelViewer(meshModelUrl) ? (
                      React.createElement("model-viewer", { src: meshModelUrl, "camera-controls": true, style: { width: "100%", height: 420, background: "transparent" } })
                    ) : (
                      <div style={{ color: "rgba(255,255,255,0.55)", padding: 24, textAlign: "center" }}>No mesh preview yet.</div>
                    )}
                  </div>
                </>
              )}

              {activeTab === "model" && (
                <>
                  <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                    <PillButton onClick={handleModelGenerate} disabled={modelBusy}>{modelBusy ? "Working..." : "Generate 3D Model"}</PillButton>
                    {modelUrl && <a href={modelUrl} style={{ color: "#67e8f9", alignSelf: "center" }}>Download Model {modelExtFromUrl(modelUrl) || "file"}</a>}
                  </div>
                  <div style={{ marginTop: 12, minHeight: 22, color: modelMsg ? "#a7f3d0" : "rgba(255,255,255,0.6)" }}>{modelMsg}</div>
                  <div style={{ marginTop: 14, borderRadius: 14, overflow: "hidden", minHeight: 420, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.08)", display: "grid", placeItems: "center" }}>
                    {modelUrl && mvReady && modelPreviewSupported && canPreviewInModelViewer(modelUrl) ? (
                      React.createElement("model-viewer", { src: modelUrl, "camera-controls": true, style: { width: "100%", height: 420, background: "transparent" } })
                    ) : modelUrl ? (
                      <div style={{ color: "rgba(255,255,255,0.72)", textAlign: "center", padding: 24 }}>
                        Browser preview is limited for this model format. Use the download link above.
                      </div>
                    ) : (
                      <div style={{ color: "rgba(255,255,255,0.55)", padding: 24, textAlign: "center" }}>No 3D model result yet.</div>
                    )}
                  </div>
                </>
              )}

              {activeTab === "trellis" && (
                <>
                  <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                    <PillButton onClick={handleTrellisGenerate} disabled={trellisBusy}>{trellisBusy ? "Working..." : "Generate Trellis 2"}</PillButton>
                    {trellisUrl && <a href={trellisUrl} style={{ color: "#67e8f9", alignSelf: "center" }}>Download Textured GLB</a>}
                  </div>
                  <div style={{ marginTop: 12, minHeight: 22, color: trellisMsg ? "#a7f3d0" : "rgba(255,255,255,0.6)" }}>{trellisMsg}</div>
                  <div style={{ marginTop: 14, borderRadius: 14, overflow: "hidden", minHeight: 420, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.08)", display: "grid", placeItems: "center" }}>
                    {trellisUrl && mvReady && canPreviewInModelViewer(trellisUrl) ? (
                      React.createElement("model-viewer", { src: trellisUrl, "camera-controls": true, style: { width: "100%", height: 420, background: "transparent" } })
                    ) : trellisUrl ? (
                      <div style={{ color: "rgba(255,255,255,0.72)", textAlign: "center", padding: 24 }}>
                        Trellis returned a file but the browser preview did not load. Use the download link above.
                      </div>
                    ) : (
                      <div style={{ color: "rgba(255,255,255,0.55)", padding: 24, textAlign: "center" }}>No Trellis 2 result yet.</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
