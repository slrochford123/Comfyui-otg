"use client";

import * as React from "react";

type Props = {
  horizontal: number;
  vertical: number;
  zoom: number;
  imageUrl?: string;
  disabled?: boolean;
  onHorizontalChange: (value: number) => void;
  onVerticalChange: (value: number) => void;
  onZoomChange: (value: number) => void;
  onReset: () => void;
};

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizePercent(value: number, min: number, max: number) {
  return ((clamp(value, min, max) - min) / (max - min)) * 100;
}

function describeHorizontal(value: number) {
  if (value > 12) return "Camera right: render subject left side";
  if (value < -12) return "Camera left: render subject right side";
  return "Camera centered: front view";
}

function describeVertical(value: number) {
  if (value > 8) return "Camera high: tilted down";
  if (value < -8) return "Camera low: tilted up";
  return "Camera level";
}

function describeZoom(value: number) {
  if (value > 0.5) return "Zoom in: camera moves closer to the source image";
  if (value < -0.5) return "Zoom out: camera moves away from the source image";
  return "Medium distance";
}

export default function AnglesDirectorCameraControl({
  horizontal,
  vertical,
  zoom,
  imageUrl = "",
  disabled = false,
  onHorizontalChange,
  onVerticalChange,
  onZoomChange,
  onReset,
}: Props) {
  const h = clamp(horizontal, -90, 90);
  const v = clamp(vertical, -45, 45);
  const z = clamp(zoom, -5, 5);

  const sourceCenterX = 50;
  const sourceCenterY = 52;

  const orbitLeft = normalizePercent(h, -90, 90);
  const orbitTop = 100 - normalizePercent(v, -45, 45);

  // Zoom is now represented as depth movement instead of icon scaling.
  // Negative zoom pushes the camera away from the image.
  // Positive zoom pulls the camera toward the image.
  const depthFactor = z >= 0 ? (z / 5) * 0.42 : (z / 5) * 0.28;
  const cameraLeft = clamp(orbitLeft + (sourceCenterX - orbitLeft) * depthFactor, 4, 96);
  const cameraTop = clamp(orbitTop + (sourceCenterY - orbitTop) * depthFactor, 4, 96);
  const cameraScale = 0.82;

  const rayEndX = sourceCenterX - (cameraLeft - sourceCenterX) * 0.14;
  const rayEndY = sourceCenterY - (cameraTop - sourceCenterY) * 0.1;

  return (
    <div className="otg-card" style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="otg-cardTitle" style={{ fontSize: 14 }}>Director Camera</div>
          <div className="otg-help" style={{ marginTop: 6 }}>
            Move the small camera around the source image. Zoom moves the camera closer or farther away.
          </div>
        </div>
        <button
          type="button"
          className="otg-btnGhost"
          onClick={onReset}
          disabled={disabled}
          style={{ borderRadius: 999, padding: "8px 12px" }}
        >
          Reset view
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          height: 260,
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 18,
          position: "relative",
          overflow: "hidden",
          background:
            "radial-gradient(circle at center, rgba(45,212,191,0.14), rgba(15,23,42,0.18) 34%, rgba(2,6,23,0.74) 72%)",
          perspective: 900,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "56%",
            width: "76%",
            height: 96,
            transform: "translate(-50%, -50%) rotateX(66deg)",
            borderRadius: "50%",
            border: "2px solid rgba(236,72,153,0.55)",
            boxShadow: "0 0 24px rgba(236,72,153,0.15)",
          }}
        />

        <div
          style={{
            position: "absolute",
            left: `${sourceCenterX}%`,
            top: `${sourceCenterY}%`,
            width: 122,
            height: 154,
            transform: "translate(-50%, -50%) rotateY(-12deg)",
            borderRadius: 16,
            border: "2px solid rgba(236,72,153,0.65)",
            background: imageUrl
              ? "rgba(15,23,42,0.42)"
              : "linear-gradient(180deg, rgba(148,163,184,0.34), rgba(30,41,59,0.52))",
            boxShadow: "0 0 40px rgba(45,212,191,0.16)",
            overflow: "hidden",
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="uploaded source used for angle direction"
              draggable={false}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                userSelect: "none",
                display: "block",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 10,
                color: "rgba(255,255,255,0.64)",
                fontSize: 12,
                textAlign: "center",
              }}
            >
              Upload source image
            </div>
          )}
        </div>

        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        >
          <line
            x1={cameraLeft}
            y1={cameraTop}
            x2={rayEndX}
            y2={rayEndY}
            stroke="rgba(250,204,21,0.78)"
            strokeWidth="0.75"
            strokeLinecap="round"
          />
          <line
            x1={cameraLeft}
            y1={cameraTop}
            x2={sourceCenterX}
            y2={sourceCenterY}
            stroke="rgba(250,204,21,0.28)"
            strokeWidth="0.45"
            strokeLinecap="round"
          />
        </svg>

        <div
          style={{
            position: "absolute",
            left: `${cameraLeft}%`,
            top: `${cameraTop}%`,
            width: 34,
            height: 24,
            transform: `translate(-50%, -50%) scale(${cameraScale})`,
            transformOrigin: "center",
            borderRadius: 8,
            border: "1.5px solid rgba(255,255,255,0.88)",
            background: disabled ? "rgba(100,116,139,0.74)" : "linear-gradient(135deg, #7c3aed, #06b6d4)",
            boxShadow: disabled ? "none" : "0 0 16px rgba(6,182,212,0.36)",
            transition: "left 120ms ease, top 120ms ease, transform 120ms ease",
          }}
          title="Director camera"
        >
          <div
            style={{
              position: "absolute",
              left: 5,
              top: -5,
              width: 14,
              height: 6,
              borderRadius: "6px 6px 2px 2px",
              background: "rgba(255,255,255,0.78)",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: -9,
              top: 6,
              width: 10,
              height: 13,
              clipPath: "polygon(0 0, 100% 50%, 0 100%)",
              background: "rgba(255,255,255,0.86)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 7,
              top: 7,
              width: 9,
              height: 9,
              borderRadius: 999,
              background: "rgba(2,6,23,0.82)",
              border: "1px solid rgba(255,255,255,0.68)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 20,
              top: 8,
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "rgba(45,212,191,0.85)",
            }}
          />
        </div>

        <div style={{ position: "absolute", left: 12, bottom: 10, color: "rgba(255,255,255,0.66)", fontSize: 11 }}>
          camera left
        </div>
        <div style={{ position: "absolute", right: 12, bottom: 10, color: "rgba(255,255,255,0.66)", fontSize: 11 }}>
          camera right
        </div>
        <div style={{ position: "absolute", right: 12, top: 10, color: "rgba(255,255,255,0.66)", fontSize: 11 }}>
          high angle
        </div>
        <div style={{ position: "absolute", right: 12, bottom: 30, color: "rgba(255,255,255,0.66)", fontSize: 11 }}>
          low angle
        </div>
      </div>

      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="otg-help">{describeHorizontal(h)}</span>
          <input
            type="range"
            min={-90}
            max={90}
            step={1}
            value={h}
            disabled={disabled}
            onChange={(e) => onHorizontalChange(Number(e.target.value))}
          />
          <div className="otg-help">Horizontal: {Math.round(h)} deg</div>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span className="otg-help">{describeVertical(v)}</span>
          <input
            type="range"
            min={-45}
            max={45}
            step={1}
            value={v}
            disabled={disabled}
            onChange={(e) => onVerticalChange(Number(e.target.value))}
          />
          <div className="otg-help">Vertical: {Math.round(v)} deg</div>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span className="otg-help">{describeZoom(z)}</span>
          <input
            type="range"
            min={-5}
            max={5}
            step={0.25}
            value={z}
            disabled={disabled}
            onChange={(e) => onZoomChange(Number(e.target.value))}
          />
          <div className="otg-help">Zoom distance: {Number(z).toFixed(2)}</div>
        </label>
      </div>
    </div>
  );
}
