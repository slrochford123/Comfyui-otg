"use client";

type TabKey = "generate" | "gallery" | "queue" | "settings";

const items: Array<{ key: TabKey; label: string }> = [
  { key: "generate", label: "Studio" },
  { key: "gallery", label: "Gallery" },
  { key: "queue", label: "History" },
  { key: "settings", label: "Settings" },
];

export default function BottomNav({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (k: TabKey) => void;
}) {
  return (
    <nav className="otg-bottom-nav" aria-label="Primary navigation">
      {items.map((it) => {
        const isActive = it.key === active;
        return (
          <button
            key={it.key}
            className={["otg-bottom-item", isActive ? "active" : ""].join(" ")}
            onClick={() => onChange(it.key)}
            type="button"
          >
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}
