"use client";

import * as React from "react";

type Props = {
  horizontal: number;
  vertical: number;
  zoom: number;
  disabled?: boolean;
  onHorizontalChange: (value: number) => void;
  onVerticalChange: (value: number) => void;
  onZoomChange: (value: number) => void;
  onReset: () => void;
  title?: string;
  backgroundImageUrl?: string;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export default function GhostCameraOrbitWidget({
  horizontal,
  vertical,
  zoom,
  disabled,
  onHorizontalChange,
  onVerticalChange,
  onZoomChange,
  onReset,
  title = "Camera",
  backgroundImageUrl,
}: Props) {
  const h = clamp(horizontal, -100, 100);
  const v = clamp(vertical, -100, 100);
  const z = clamp(zoom, -100, 100);

  const orbitT = h / 100; // -1..1 front-half arc
  const theta = orbitT * Math.PI * 0.9; // left..right, capped short of full side wrap
  const radiusX = 120;
  const radiusZ = 64;
  const x = Math.sin(theta) * radiusX;
  const zArc = Math.cos(theta) * radiusZ;
  const baseY = 4;
  const pitch = clamp(v * 0.45, -35, 35);
  const dolly = z * 0.75;
  const translateZ = Math.round(zArc - dolly);
  const scale = clamp(1.1 - translateZ / 220, 0.72, 1.55);
  const yaw = -orbitT * 70;
  const roll = -orbitT * 8;

  const cameraStyle: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "52%",
    transformStyle: "preserve-3d",
    transform: `translate3d(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${baseY.toFixed(1)}px), ${translateZ.toFixed(1)}px) rotateY(${yaw.toFixed(1)}deg) rotateX(${pitch.toFixed(1)}deg) rotateZ(${roll.toFixed(1)}deg) scale(${scale.toFixed(3)})`,
    transition: disabled ? "none" : "transform 140ms ease-out",
    pointerEvents: "none",
  };

  const bodyStyle: React.CSSProperties = {
    position: "relative",
    width: 92,
    height: 54,
    transformStyle: "preserve-3d",
  };

  const panelStyle: React.CSSProperties = {
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "linear-gradient(180deg, rgba(4,8,26,0.94), rgba(7,10,24,0.96))",
    boxShadow: "0 18px 44px rgba(0,0,0,0.32)",
    overflow: "hidden",
  };

  const controlBtn = (activeColor: string): React.CSSProperties => ({
    borderRadius: 16,
    padding: "12px 12px 10px",
    border: `1px solid ${activeColor}`,
    background: "rgba(255,255,255,0.03)",
    color: "white",
    minWidth: 84,
    textAlign: "center",
    opacity: disabled ? 0.55 : 1,
  });

  const valueLabel = (text: string, color: string) => (
    <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, color }}>{text}</div>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...panelStyle, padding: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>{title}</div>
        <div
          style={{
            position: "relative",
            minHeight: 244,
            borderRadius: 18,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            background: backgroundImageUrl
              ? `linear-gradient(rgba(7,10,24,0.25), rgba(7,10,24,0.35)), url(${backgroundImageUrl}) center/cover no-repeat`
              : "radial-gradient(circle at 50% 30%, rgba(17,33,88,0.45), rgba(4,8,24,0.98) 62%)",
          }}
        >
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.42))" }} />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "64%",
              width: 286,
              height: 116,
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              border: "6px solid rgba(255, 72, 181, 0.9)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 0 28px rgba(255, 72, 181, 0.18)",
              opacity: 0.9,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "64%",
              width: 150,
              height: 48,
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              border: "2px solid rgba(47,116,255,0.45)",
              opacity: 0.8,
            }}
          />

          <div style={cameraStyle} aria-hidden>
            <div style={bodyStyle}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 14,
                  transformStyle: "preserve-3d",
                  transform: "translateZ(0px)",
                }}
              >
                <div style={{ position: "absolute", inset: 0, borderRadius: 14, background: "linear-gradient(145deg, #3ef1dc, #58b1ff)", transform: "translateZ(12px)", boxShadow: "0 10px 22px rgba(0,0,0,0.32)" }} />
                <div style={{ position: "absolute", inset: 0, borderRadius: 14, background: "rgba(255,255,255,0.18)", transform: "translateZ(-12px)" }} />
                <div style={{ position: "absolute", left: -12, top: 6, width: 24, height: 42, borderRadius: 12, background: "linear-gradient(145deg, #2de0d8, #3291ff)", transform: "rotateY(90deg) translateZ(12px)" }} />
                <div style={{ position: "absolute", right: -12, top: 6, width: 24, height: 42, borderRadius: 12, background: "linear-gradient(145deg, #ff5dc7, #ff4fb2)", transform: "rotateY(90deg) translateZ(-12px)" }} />
                <div style={{ position: "absolute", left: 10, right: 10, top: -10, height: 20, borderRadius: 10, background: "linear-gradient(145deg, #f35adb, #855cff)", transform: "rotateX(90deg) translateZ(10px)" }} />
                <div style={{ position: "absolute", left: 10, right: 10, bottom: -10, height: 20, borderRadius: 10, background: "linear-gradient(145deg, #f0c02d, #ff8f3d)", transform: "rotateX(90deg) translateZ(-10px)" }} />
              </div>

              <div
                style={{
                  position: "absolute",
                  right: -4,
                  top: 11,
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: "radial-gradient(circle at 35% 35%, #ff83d8, #f04fb5 60%, #8a1b7c 100%)",
                  boxShadow: "0 0 0 6px rgba(255,255,255,0.07), 0 0 18px rgba(240,79,181,0.28)",
                  transform: "translateZ(20px)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 22,
                  bottom: -4,
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "radial-gradient(circle at 35% 35%, #ffe36d, #ffb20a 65%, #8e5a00 100%)",
                  boxShadow: "0 0 0 4px rgba(255,255,255,0.07)",
                  transform: "translateZ(14px)",
                }}
              />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={controlBtn("rgba(255,72,181,0.4)")}>
            <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: 0.7 }}>HORIZONTAL</div>
            {valueLabel(`${Math.round(h)}°`, "#ff5dc7")}
          </div>
          <div style={controlBtn("rgba(62,241,220,0.4)")}>
            <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: 0.7 }}>VERTICAL</div>
            {valueLabel(`${Math.round(v)}°`, "#3ef1dc")}
          </div>
          <div style={controlBtn("rgba(255,194,45,0.4)")}>
            <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: 0.7 }}>ZOOM</div>
            {valueLabel(z.toFixed(1), "#ffd33d")}
          </div>
          <button type="button" className="otg-btnGhost" onClick={onReset} disabled={disabled} style={{ borderRadius: 16, minWidth: 90 }}>
            Reset
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <label className="otg-card" style={{ padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.74, marginBottom: 8 }}>Horizontal</div>
          <input type="range" min={-100} max={100} step={1} value={h} disabled={disabled} onChange={(e) => onHorizontalChange(Number(e.target.value))} style={{ width: "100%" }} />
        </label>
        <label className="otg-card" style={{ padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.74, marginBottom: 8 }}>Vertical</div>
          <input type="range" min={-100} max={100} step={1} value={v} disabled={disabled} onChange={(e) => onVerticalChange(Number(e.target.value))} style={{ width: "100%" }} />
        </label>
        <label className="otg-card" style={{ padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.74, marginBottom: 8 }}>Zoom</div>
          <input type="range" min={-100} max={100} step={1} value={z} disabled={disabled} onChange={(e) => onZoomChange(Number(e.target.value))} style={{ width: "100%" }} />
        </label>
      </div>
    </div>
  );
}
