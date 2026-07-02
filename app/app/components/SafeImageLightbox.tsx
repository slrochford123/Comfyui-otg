"use client";

import React from "react";

type SafeImageLightboxProps = {
  open: boolean;
  src: string;
  alt: string;
  title?: string;
  onClose: () => void;
};

function stopNativeImageGesture(event: React.SyntheticEvent) {
  event.preventDefault();
}

export default function SafeImageLightbox({ open, src, alt, title, onClose }: SafeImageLightboxProps) {
  const [scale, setScale] = React.useState(1);

  React.useEffect(() => {
    if (!open) return;
    setScale(1);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open || !src) return null;

  const zoomIn = () => setScale((current) => Math.min(4, Number((current + 0.25).toFixed(2))));
  const zoomOut = () => setScale((current) => Math.max(1, Number((current - 0.25).toFixed(2))));
  const resetZoom = () => setScale(1);

  return (
    <div
      className="otg-imageLightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title || alt || "Image preview"}
      onClick={onClose}
      onContextMenu={stopNativeImageGesture}
    >
      <div className="otg-imageLightboxBar" onClick={(event) => event.stopPropagation()}>
        <div className="min-w-0 truncate text-sm font-semibold text-white/85">{title || alt || "Image preview"}</div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="otg-imageLightboxBtn" onClick={zoomOut} aria-label="Zoom out">
            -
          </button>
          <button type="button" className="otg-imageLightboxBtn" onClick={resetZoom}>
            {Math.round(scale * 100)}%
          </button>
          <button type="button" className="otg-imageLightboxBtn" onClick={zoomIn} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="otg-imageLightboxBtn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="otg-imageLightboxStage" onClick={(event) => event.stopPropagation()}>
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="otg-safeImage otg-imageLightboxImage"
          style={{ transform: `scale(${scale})` }}
          onContextMenu={stopNativeImageGesture}
          onDragStart={stopNativeImageGesture}
        />
      </div>
    </div>
  );
}
