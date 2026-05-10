"use client";

import * as React from "react";

const HORIZONTAL_MIN = -180;
const HORIZONTAL_MAX = 180;
const VERTICAL_MIN = -30;
const VERTICAL_MAX = 60;
const ZOOM_MIN = -5;
const ZOOM_MAX = 5;
const HORIZONTAL_DEG_PER_PIXEL = 0.85;
const VERTICAL_DEG_PER_PIXEL = 0.45;
const ZOOM_PER_PINCH_PIXEL = 0.03;
const ZOOM_PER_WHEEL_STEP = 0.35;
const CARD_HORIZONTAL_DEG_PER_PIXEL = 0.9;
const CARD_VERTICAL_DEG_PER_PIXEL = 0.45;
const CARD_ZOOM_PER_PIXEL = 0.035;

type PointerPoint = { x: number; y: number };

type DragMetric = "horizontal" | "vertical" | "zoom" | null;

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function distance(a: PointerPoint, b: PointerPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export type OtgMultiAngleControlProps = {
  horizontal: number;
  vertical: number;
  zoom: number;
  disabled?: boolean;
  onHorizontalChange: (next: number) => void;
  onVerticalChange: (next: number) => void;
  onZoomChange: (next: number) => void;
  onReset: () => void;
  title?: string;
  imageUrl?: string;
  helperText?: string;
  showHelperText?: boolean;
  showPromptText?: boolean;
  showSelectors?: boolean;
  showSliders?: boolean;
  showGestureHint?: boolean;
};

export default function OtgMultiAngleControl({
  horizontal,
  vertical,
  zoom,
  disabled,
  onHorizontalChange,
  onVerticalChange,
  onZoomChange,
  onReset,
  title = "OTG Multi-Angle Camera",
  imageUrl: _imageUrl = "",
  helperText = "",
  showHelperText = false,
  showPromptText = false,
  showSelectors = false,
  showSliders = false,
  showGestureHint = false,
}: OtgMultiAngleControlProps) {
  const normalizedH = ((horizontal % 360) + 360) % 360;
  const orbitRadians = (normalizedH / 180) * Math.PI;
  const x = 150 + Math.cos(orbitRadians) * 78;
  const y = 152 + Math.sin(orbitRadians) * 42;
  const verticalYOffset = clamp(-vertical * 1.4, -70, 55);
  const zoomScale = 1 + clamp(zoom / 10, -0.35, 0.55);

  const activePointersRef = React.useRef<Map<number, PointerPoint>>(new Map());
  const dragStateRef = React.useRef<{
    horizontal: number;
    vertical: number;
    zoom: number;
    pointerId: number | null;
    startX: number;
    startY: number;
    pinchDistance: number | null;
    pinching: boolean;
  }>({
    horizontal,
    vertical,
    zoom,
    pointerId: null,
    startX: 0,
    startY: 0,
    pinchDistance: null,
    pinching: false,
  });

  const metricDragRef = React.useRef<{
    metric: DragMetric;
    pointerId: number | null;
    startX: number;
    startY: number;
    baseHorizontal: number;
    baseVertical: number;
    baseZoom: number;
  }>({
    metric: null,
    pointerId: null,
    startX: 0,
    startY: 0,
    baseHorizontal: horizontal,
    baseVertical: vertical,
    baseZoom: zoom,
  });

  React.useEffect(() => {
    dragStateRef.current.horizontal = horizontal;
    dragStateRef.current.vertical = vertical;
    dragStateRef.current.zoom = zoom;
    metricDragRef.current.baseHorizontal = horizontal;
    metricDragRef.current.baseVertical = vertical;
    metricDragRef.current.baseZoom = zoom;
  }, [horizontal, vertical, zoom]);

  const clearPointer = React.useCallback((pointerId: number) => {
    activePointersRef.current.delete(pointerId);
    const state = dragStateRef.current;
    if (state.pointerId === pointerId) state.pointerId = null;
    if (activePointersRef.current.size < 2) {
      state.pinchDistance = null;
      state.pinching = false;
    }
  }, []);

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      const target = event.currentTarget;
      target.setPointerCapture?.(event.pointerId);
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const state = dragStateRef.current;

      if (activePointersRef.current.size >= 2) {
        const points = Array.from(activePointersRef.current.values());
        state.pinchDistance = distance(points[0], points[1]);
        state.pinching = true;
        state.zoom = zoom;
        return;
      }

      state.pointerId = event.pointerId;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.horizontal = horizontal;
      state.vertical = vertical;
      state.pinching = false;
    },
    [disabled, horizontal, vertical, zoom]
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (!activePointersRef.current.has(event.pointerId)) return;
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const state = dragStateRef.current;

      if (activePointersRef.current.size >= 2) {
        const points = Array.from(activePointersRef.current.values());
        const nextDistance = distance(points[0], points[1]);
        const baseDistance = state.pinchDistance ?? nextDistance;
        const delta = nextDistance - baseDistance;
        const nextZoom = clamp(state.zoom + delta * ZOOM_PER_PINCH_PIXEL, ZOOM_MIN, ZOOM_MAX);
        state.pinching = true;
        onZoomChange(nextZoom);
        return;
      }

      if (state.pinching || state.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      const nextHorizontal = clamp(state.horizontal + deltaX * HORIZONTAL_DEG_PER_PIXEL, HORIZONTAL_MIN, HORIZONTAL_MAX);
      const nextVertical = clamp(state.vertical - deltaY * VERTICAL_DEG_PER_PIXEL, VERTICAL_MIN, VERTICAL_MAX);
      onHorizontalChange(nextHorizontal);
      onVerticalChange(nextVertical);
    },
    [disabled, onHorizontalChange, onVerticalChange, onZoomChange]
  );

  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      clearPointer(event.pointerId);
    },
    [clearPointer]
  );

  const handleWheel = React.useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (disabled) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -ZOOM_PER_WHEEL_STEP : ZOOM_PER_WHEEL_STEP;
      onZoomChange(clamp(zoom + delta, ZOOM_MIN, ZOOM_MAX));
    },
    [disabled, onZoomChange, zoom]
  );

  const startMetricDrag = React.useCallback(
    (metric: Exclude<DragMetric, null>) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      const target = event.currentTarget;
      target.setPointerCapture?.(event.pointerId);
      metricDragRef.current = {
        metric,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        baseHorizontal: horizontal,
        baseVertical: vertical,
        baseZoom: zoom,
      };
    },
    [disabled, horizontal, vertical, zoom]
  );

  const handleMetricMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = metricDragRef.current;
      if (disabled || state.pointerId !== event.pointerId || !state.metric) return;
      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;

      if (state.metric === "horizontal") {
        onHorizontalChange(clamp(state.baseHorizontal + deltaX * CARD_HORIZONTAL_DEG_PER_PIXEL, HORIZONTAL_MIN, HORIZONTAL_MAX));
        return;
      }
      if (state.metric === "vertical") {
        onVerticalChange(clamp(state.baseVertical - deltaY * CARD_VERTICAL_DEG_PER_PIXEL, VERTICAL_MIN, VERTICAL_MAX));
        return;
      }
      onZoomChange(clamp(state.baseZoom + deltaX * CARD_ZOOM_PER_PIXEL, ZOOM_MIN, ZOOM_MAX));
    },
    [disabled, onHorizontalChange, onVerticalChange, onZoomChange]
  );

  const stopMetricDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = metricDragRef.current;
    if (state.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      metricDragRef.current.pointerId = null;
      metricDragRef.current.metric = null;
    }
  }, []);

  return (
    <div
      style={{
        borderRadius: 20,
        border: "1px solid rgba(255, 79, 166, 0.45)",
        background: "linear-gradient(180deg, rgba(8,12,23,0.98) 0%, rgba(5,8,16,0.98) 100%)",
        boxShadow: "0 0 0 1px rgba(39,240,208,0.08) inset, 0 20px 36px rgba(0,0,0,0.28)",
        padding: 16,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, color: "#f5f7ff" }}>{title}</div>
      {showHelperText && helperText ? (
        <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.45, color: "rgba(233,239,255,0.72)" }}>{helperText}</div>
      ) : null}

      {showPromptText ? (
        <div
          style={{
            marginTop: 14,
            borderRadius: 14,
            border: "1px solid rgba(255, 79, 166, 0.5)",
            padding: "12px 14px",
            color: "#ff68b5",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 14,
            background: "rgba(14, 9, 21, 0.96)",
          }}
        >
          Camera control prompt preview hidden in Angles compact mode by default.
        </div>
      ) : null}

      {showSelectors ? (
        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <div className="otg-help" style={{ marginTop: 0 }}>Preset selector mode is hidden in the current Angles compact layout.</div>
        </div>
      ) : null}

      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        style={{
          marginTop: 14,
          borderRadius: 18,
          border: "1px solid rgba(255, 79, 166, 0.22)",
          background:
            "radial-gradient(circle at 50% 35%, rgba(31,49,93,0.35) 0%, rgba(8,10,18,0.95) 70%), linear-gradient(180deg, rgba(5,8,16,0.95), rgba(3,5,12,0.98))",
          padding: 10,
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: disabled ? "default" : "grab",
        }}
      >
        <svg viewBox="0 0 300 210" width="100%" height="260" role="img" aria-label="Multi-angle camera orbit preview. Drag to adjust horizontal and vertical. Pinch or mouse-wheel to zoom.">
          <ellipse cx="150" cy="152" rx="108" ry="54" fill="none" stroke="#ff4fa6" strokeWidth="5" opacity="0.8" />
          <ellipse cx="150" cy="152" rx="56" ry="25" fill="none" stroke="#273763" strokeWidth="1.5" opacity="0.55" />
          <rect x={135} y={88 + verticalYOffset / 5} width={48 * zoomScale} height={82 * zoomScale} fill="#4f5163" stroke="#ff4fa6" strokeWidth="2" opacity="0.9" />
          <line x1="150" y1="152" x2={x} y2={y} stroke="#ffcc29" strokeWidth="4" />
          <line x1="150" y1="152" x2="150" y2={66 + verticalYOffset} stroke="#27f0d0" strokeWidth="5" strokeLinecap="round" />
          <circle cx="150" cy="152" r={15 * zoomScale} fill="#ffcc29" opacity="0.95" />
          <circle cx={x} cy={y} r="18" fill="#ff4fa6" opacity="0.95" />
          <circle cx="82" cy={66 + verticalYOffset} r="16" fill="#27f0d0" opacity="0.9" />
          <line x1={x} y1={y} x2="150" y2={66 + verticalYOffset} stroke="#ff4fa6" strokeWidth="2" opacity="0.45" />
        </svg>
      </div>

      {showGestureHint ? (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.45, color: "rgba(233,239,255,0.72)" }}>
          Drag inside the camera box to adjust horizontal and vertical. Use two fingers to pinch for zoom on touch screens.
        </div>
      ) : null}

      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, alignItems: "stretch" }}>
        <MetricCard
          label="horizontal"
          value={`${Math.round(horizontal)}°`}
          accent="#ff4fa6"
          disabled={disabled}
          axis="horizontal"
          onPointerDown={startMetricDrag("horizontal")}
          onPointerMove={handleMetricMove}
          onPointerUp={stopMetricDrag}
        />
        <MetricCard
          label="vertical"
          value={`${Math.round(vertical)}°`}
          accent="#27f0d0"
          disabled={disabled}
          axis="vertical"
          onPointerDown={startMetricDrag("vertical")}
          onPointerMove={handleMetricMove}
          onPointerUp={stopMetricDrag}
        />
        <MetricCard
          label="zoom"
          value={zoom.toFixed(1)}
          accent="#ffcc29"
          disabled={disabled}
          axis="zoom"
          onPointerDown={startMetricDrag("zoom")}
          onPointerMove={handleMetricMove}
          onPointerUp={stopMetricDrag}
        />
        <button
          type="button"
          onClick={onReset}
          disabled={disabled}
          style={{
            borderRadius: 14,
            border: "1px solid rgba(255, 79, 166, 0.5)",
            background: "rgba(18, 11, 24, 0.98)",
            color: "#ff68b5",
            fontSize: 13,
            fontWeight: 700,
            cursor: disabled ? "default" : "pointer",
            minHeight: 72,
            minWidth: 72,
          }}
        >
          Reset
        </button>
      </div>

      {showSliders ? (
        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          <SliderRow label="Horizontal" value={horizontal} min={HORIZONTAL_MIN} max={HORIZONTAL_MAX} step={1} onChange={onHorizontalChange} disabled={disabled} />
          <SliderRow label="Vertical" value={vertical} min={VERTICAL_MIN} max={VERTICAL_MAX} step={1} onChange={onVerticalChange} disabled={disabled} />
          <SliderRow label="Zoom" value={zoom} min={ZOOM_MIN} max={ZOOM_MAX} step={0.1} onChange={onZoomChange} disabled={disabled} />
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
  disabled,
  axis,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  label: string;
  value: string;
  accent: string;
  disabled?: boolean;
  axis: "horizontal" | "vertical" | "zoom";
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const cursor = axis === "vertical" ? "ns-resize" : "ew-resize";
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      title={axis === "vertical" ? "Drag up and down to change vertical angle." : axis === "zoom" ? "Drag left and right to zoom." : "Drag left and right to change horizontal angle."}
      style={{
        borderRadius: 14,
        border: `1px solid ${accent}55`,
        background: "rgba(8, 11, 20, 0.9)",
        padding: "12px 10px",
        textAlign: "center",
        cursor: disabled ? "default" : cursor,
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "rgba(233,239,255,0.58)" }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 24, lineHeight: 1, fontWeight: 800, color: accent }}>{value}</div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6, fontSize: 12, color: "rgba(233,239,255,0.72)" }}>
        <span>{label}</span>
        <span>{value.toFixed(step < 1 ? 1 : 0)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        style={{ width: "100%", minHeight: 32 }}
      />
    </div>
  );
}
