"use client";

type Props = { name: string };

export function GalleryItemActions({ name }: Props) {
  function download() {
    const a = document.createElement("a");
    a.href = `/api/gallery/file?name=${encodeURIComponent(name)}&download=1`;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="otg-gallery-actions">
      <button className="otg-btn otg-btn-secondary" onClick={download}>
        Download
      </button>
    </div>
  );
}
