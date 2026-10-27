import React from "react";
import { getH3SpeedRating, type H3SpeedQuality, type H3SpeedSettings } from "@/lib/h3SpeedRating";

const RATINGS = {
  slow: { label: "Slow", bars: 1, color: "text-red-400" },
  medium: { label: "Medium", bars: 2, color: "text-yellow-300" },
  fast: { label: "Fast", bars: 3, color: "text-green-400" },
} as const;
const BAR_HEIGHTS = [12, 20, 28] as const;

export default function H3SpeedIndicator({ settings, quality }: { settings: H3SpeedSettings; quality: H3SpeedQuality }) {
  const speed = getH3SpeedRating(settings, quality);
  const rating = RATINGS[speed];
  return (
    <div role="status" aria-live="polite" aria-atomic="true" aria-label={`Generation speed: ${rating.label}`}
      data-otg="h3-generation-speed" data-speed={speed} className="mt-3 min-w-0">
      <div className={`flex flex-col items-start gap-2 ${rating.color}`}>
        <span className="text-3xl font-black leading-tight">{rating.label}</span>
        <span aria-hidden="true" className="flex h-7 items-end gap-1.5">
          {BAR_HEIGHTS.slice(0, rating.bars).map(height => (
            <span key={height} data-otg="h3-speed-bar" className="block w-4 rounded-sm bg-current" style={{ height }} />
          ))}
        </span>
      </div>
      <p className="mt-2 text-xs text-white/50">Relative speed; actual time varies by video and GPU.</p>
    </div>
  );
}
