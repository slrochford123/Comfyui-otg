type Props = {
  resolution: number;
  onResolution: (v: number) => void;
  orientation: "landscape" | "portrait";
  onOrientation: (v: "landscape" | "portrait") => void;
};

export default function ResolutionControls({
  resolution,
  onResolution,
  orientation,
  onOrientation,
}: Props) {
  const isPortrait = orientation === "portrait";

  return (
    <div className="otg-section">
      <div className="flex items-center justify-between">
        <div className="otg-label">Resolution</div>
        <div className="otg-pill">{resolution}p</div>
      </div>

      <div className="mt-4">
        <input
          className="otg-range"
          type="range"
          min={512}
          max={1080}
          step={64}
          value={resolution}
          onChange={(e) => onResolution(Number(e.target.value))}
        />
        <div className="mt-2 flex justify-between text-xs opacity-60">
          <span>512</span>
          <span>1080</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="otg-label">Orientation</div>

        <div className="flex gap-2">
          <button
            onClick={() => onOrientation("landscape")}
            className={[
              "px-4 py-2 rounded-full font-extrabold text-sm transition",
              "border",
              !isPortrait
                ? "border-white/15 bg-white/10 text-white"
                : "border-white/10 bg-black/20 text-white/70",
            ].join(" ")}
          >
            Landscape
          </button>
          <button
            onClick={() => onOrientation("portrait")}
            className={[
              "px-4 py-2 rounded-full font-extrabold text-sm transition",
              "border",
              isPortrait
                ? "border-white/15 bg-white/10 text-white"
                : "border-white/10 bg-black/20 text-white/70",
            ].join(" ")}
          >
            Portrait
          </button>
        </div>
      </div>

      <div className="mt-3 text-sm opacity-60">
        {isPortrait ? "Portrait: taller frame." : "Landscape: wide frame."}
      </div>
    </div>
  );
}
