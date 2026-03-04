"use client";

import React from "react";

export type TabId = "generate" | "gallery" | "favorites" | "settings" | "admin";

export default function BottomNav({
  tab,
  onTab,
  showAdmin,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  showAdmin?: boolean;
}) {
  // NOTE: This component is kept for backwards compatibility.
  // The new navigation UI is SpinDialNav.
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
      {showAdmin ? item("admin", "Admin") : null}
    </nav>
  );
}
