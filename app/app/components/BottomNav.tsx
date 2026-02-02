"use client";

import React from "react";

export type TabId = "generate" | "gallery" | "favorites" | "settings";

export default function BottomNav({
  tab,
  onTab,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
}) {
  const item = (id: TabId, label: string) => {
    const active = tab === id;
    return (
      <button
        key={id}
        type="button"
        className={"otg-nav-item" + (active ? " otg-nav-active" : "")}
        onClick={() => onTab(id)}
      >
        {label}
      </button>
    );
  };

  return (
    <nav className="otg-bottom-nav" role="navigation" aria-label="OTG Bottom Navigation">
      {item("generate", "Studio")}
      {item("gallery", "Gallery")}
      {item("favorites", "Favorites")}
      {item("settings", "Settings")}
    </nav>
  );
}
