"use client";

import * as React from "react";
type StatusPayload = {
  ok: boolean;
  jobId?: string;
  status?: "queued" | "processing" | "succeeded" | "failed";
  message?: string;
  progressStage?: string;
  inputImageUrl?: string;
  resultUrl?: string | null;
  previewSupported?: boolean;
  promptId?: string | null;
  endpoint?: string | null;
  preprocessNote?: string | null;
  error?: string | null;
  updatedAt?: string;
};

type ResultPayload = {
  ok: boolean;
  modelUrl?: string;
  modelExt?: string | null;
  previewSupported?: boolean;
  inputImageUrl?: string;
  preprocessNote?: string | null;
  endpoint?: string | null;
  promptId?: string | null;
};

function cardStyle(): React.CSSProperties {
  return {
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(12,14,20,0.88)",
    boxShadow: "0 24px 70px rgba(0,0,0,0.32)",
    padding: 18,
  };
}

function buttonStyle(primary = false): React.CSSProperties {
  return {
    borderRadius: 999,
    border: primary ? "1px solid rgba(103,232,249,0.45)" : "1px solid rgba(255,255,255,0.16)",
    background: primary ? "linear-gradient(90deg, rgba(56,189,248,0.28), rgba(168,85,247,0.28))" : "rgba(255,255,255,0.05)",
    color: "white",
    padding: "12px 18px",
    fontWeight: 700,
    cursor: "pointer",
  };
}

export default function ThreeDPocPage() {
  const [mvReady, setMvReady] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = React.useState("");
  const [removeBackground, setRemoveBackground] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [jobId, setJobId] = React.useState("");
  const [status, setStatus] = React.useState<StatusPayload | null>(null);
  const [result, setResult] = React.useState<ResultPayload | null>(null);
  const [error, setError] = React.useState("");

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

  React.useEffect(() => {
    if (!jobId) return;
    let timer: number | null = null;
    let stopped = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/3d/status?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as StatusPayload | null;
        if (!json) throw new Error(`Status request failed (${res.status}).`);
        setStatus(json);

        if (json.status === "succeeded") {
          const rr = await fetch(`/api/3d/result?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
          const rj = (await rr.json().catch(() => null)) as ResultPayload | null;
          if (rj && rj.ok) {
            setResult(rj);
            setBusy(false);
            return;
          }
        }

        if (json.status === "failed") {
          setError(json.error || json.message || "3D job failed.");
          setBusy(false);
          return;
        }
      } catch (e: any) {
        setError(e?.message || String(e));
        setBusy(false);
        return;
      }

      if (!stopped) {
        timer = window.setTimeout(poll, 2500);
      }
    };

    poll();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [jobId]);

  React.useEffect(() => {
    if (!file) {
      setFilePreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function handleSubmit() {
    if (!file) {
      setError("Choose an image first.");
      return;
    }
    setBusy(true);
    setError("");
    setJobId("");
    setStatus(null);
    setResult(null);

    const fd = new FormData();
    fd.append("image", file);
    fd.append("removeBackground", String(removeBackground));

    try {
      const res = await fetch("/api/3d/generate", {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Generate failed (${res.status}).`);
      }
      setJobId(String(json.jobId || ""));
      setStatus({
        ok: true,
        jobId: String(json.jobId || ""),
        status: "queued",
        message: String(json.message || "3D job created."),
        inputImageUrl: String(json.inputImageUrl || ""),
      });
    } catch (e: any) {
      setBusy(false);
      setError(e?.message || String(e));
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, rgba(34,211,238,0.14), transparent 28%), radial-gradient(circle at right, rgba(168,85,247,0.14), transparent 24%), #090b10",
        color: "white",
        padding: 20,
      }}
    >
      <div style={{ maxWidth: 1240, margin: "0 auto", display: "grid", gap: 18 }}>
        <div style={cardStyle()}>
          <div style={{ fontSize: 30, fontWeight: 900 }}>3D Upload POC</div>
          <div style={{ marginTop: 8, color: "rgba(255,255,255,0.72)", lineHeight: 1.5 }}>
            First proof-of-concept route for: upload one image, send it through the Trellis 2 textured 3D pipeline, then return a downloadable GLB.
            This page lives at <span style={{ color: "#67e8f9" }}>/app/3d-poc</span>.
          </div>
          <div style={{ marginTop: 12, color: "rgba(255,255,255,0.58)", fontSize: 13 }}>
            Current rework checklist note: Angles now has a standalone 3D upload proof-of-concept page for image -&gt; textured model return testing.
          </div>
        </div>

        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(320px, 400px) minmax(0, 1fr)" }}>
          <div style={{ ...cardStyle(), display: "grid", gap: 14, alignContent: "start" }}>
            <label style={{ fontWeight: 800 }}>Source image</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 12,
                color: "white",
              }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 10, color: "rgba(255,255,255,0.82)" }}>
              <input type="checkbox" checked={removeBackground} onChange={(e) => setRemoveBackground(e.target.checked)} />
              Remove background before 3D processing
            </label>
            <button type="button" onClick={handleSubmit} disabled={busy} style={buttonStyle(true)}>
              {busy ? "Running 3D pipeline..." : "Generate 3D model"}
            </button>
            {jobId ? <div style={{ fontSize: 12, color: "rgba(255,255,255,0.66)" }}>Job ID: {jobId}</div> : null}
            {error ? <div style={{ color: "#fca5a5", fontWeight: 700 }}>{error}</div> : null}
            {status ? (
              <div style={{ borderRadius: 16, background: "rgba(255,255,255,0.04)", padding: 14, fontSize: 14, lineHeight: 1.6 }}>
                <div><b>Status:</b> {status.status || "unknown"}</div>
                <div><b>Stage:</b> {status.progressStage || "n/a"}</div>
                <div><b>Message:</b> {status.message || "n/a"}</div>
                {status.preprocessNote ? <div><b>Preprocess:</b> {status.preprocessNote}</div> : null}
                {status.endpoint ? <div><b>Endpoint:</b> {status.endpoint}</div> : null}
                {status.promptId ? <div><b>Prompt ID:</b> {status.promptId}</div> : null}
                {status.updatedAt ? <div><b>Updated:</b> {status.updatedAt}</div> : null}
              </div>
            ) : null}
          </div>

          <div style={{ ...cardStyle(), minHeight: 520 }}>
            <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(240px, 360px) minmax(0, 1fr)" }}>
              <div>
                <div style={{ fontWeight: 800, marginBottom: 10 }}>Input preview</div>
                <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.12)", overflow: "hidden", minHeight: 280, background: "rgba(255,255,255,0.03)" }}>
                  {filePreviewUrl ? (
                    <img src={filePreviewUrl} alt="3D upload source" style={{ width: "100%", display: "block", objectFit: "contain", maxHeight: 420 }} />
                  ) : (
                    <div style={{ padding: 24, color: "rgba(255,255,255,0.5)" }}>No source image selected yet.</div>
                  )}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 800, marginBottom: 10 }}>Model result</div>
                <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.12)", overflow: "hidden", minHeight: 420, background: "rgba(255,255,255,0.03)" }}>
                  {result?.ok && result.modelUrl ? (
                    mvReady && result.previewSupported ? (
                      React.createElement("model-viewer", {
                        src: result.modelUrl,
                        "camera-controls": true,
                        "auto-rotate": true,
                        style: { width: "100%", height: 420, background: "transparent" },
                      })
                    ) : (
                      <div style={{ padding: 24, color: "rgba(255,255,255,0.7)" }}>
                        Browser preview is not available for this format. Use the download link below.
                      </div>
                    )
                  ) : (
                    <div style={{ padding: 24, color: "rgba(255,255,255,0.5)" }}>
                      No 3D model yet. Submit an image to start the Trellis 2 pipeline.
                    </div>
                  )}
                </div>
                {result?.ok && result.modelUrl ? (
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
                    <a href={result.modelUrl} style={{ ...buttonStyle(true), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                      Download {result.modelExt || ".glb"}
                    </a>
                    {jobId ? (
                      <a href={`/api/3d/result?jobId=${encodeURIComponent(jobId)}`} style={{ ...buttonStyle(false), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                        Open result JSON
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
