"use client";

import React from "react";

type LightboxProps = {
  open: boolean;
  src: string | null;
  name?: string | null;
  isVideo?: boolean;
  onClose: () => void;
};

export default function Lightbox({
  open,
  src,
  name,
  isVideo,
  onClose,
}: LightboxProps) {
  if (!open || !src) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {isVideo ? (
          <video
            src={src}
            controls
            autoPlay
            className="max-h-[90vh] max-w-[90vw] rounded-lg"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={name || "preview"}
            className="max-h-[90vh] max-w-[90vw] rounded-lg"
          />
        )}

        <button
          onClick={onClose}
          className="absolute -top-4 -right-4 rounded-full bg-black/80 px-3 py-1 text-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
