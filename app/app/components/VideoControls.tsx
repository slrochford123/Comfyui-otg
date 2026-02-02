type Props = { value: number; onChange: (v: number) => void; max?: number };

export default function VideoControls({ value, onChange, max = 30 }: Props) {
  const active = value > 0;

  return (
    <div className="otg-section">
      <div className="flex items-center justify-between">
        <div className="otg-label">Video length</div>
        <div className={active ? "otg-pill otg-pill-red" : "otg-pill"}>{value}s</div>
      </div>

      <div className="mt-4">
        <input
          className="otg-range"
          type="range"
          min={0}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <div className="mt-2 flex justify-between text-xs opacity-60">
          <span>Still image (0)</span>
          <span>VIDEO ({max})</span>
        </div>
      </div>
    </div>
  );
}
