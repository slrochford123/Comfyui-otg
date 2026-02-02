type Props = { value: string; onChange: (v: string) => void };

export default function PromptBox({ value, onChange }: Props) {
  return (
    <div className="otg-section">
      <div className="flex items-center justify-between mb-3">
        <div className="otg-label">Prompt</div>
        <div className="text-xs opacity-60">Describe the shot</div>
      </div>

      <textarea
        className="otg-input"
        style={{ minHeight: 130 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Describe what you want…"
      />

      <div className="mt-3 text-sm opacity-60">
        Tip: short, cinematic, specific.
      </div>
    </div>
  );
}
