"use client";

import React from "react";

type GalleryAutoPanelProps = Record<string, unknown>;

function getText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function GalleryAutoPanel(props: GalleryAutoPanelProps) {
  const title = getText(props.title, "Gallery");
  const description = getText(
    props.description,
    "Gallery tools are available from the main app gallery controls."
  );

  return (
    <section data-testid="gallery-auto-panel" className="otg-card" aria-label={title}>
      <div className="otg-cardTitle">{title}</div>
      <div className="otg-cardBody">
        <p style={{ margin: 0, opacity: 0.85 }}>{description}</p>
      </div>
    </section>
  );
}

export default GalleryAutoPanel;
