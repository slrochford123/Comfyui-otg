import React from "react";

const style = "inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-sm font-bold";

export default function ImageDownloadButton({url, filename}: {url?: string; filename?: string}) {
  if (!url) return <button type="button" disabled className={`${style} cursor-not-allowed border-emerald-500/20 bg-emerald-950/50 text-emerald-200/45`}>Download</button>;
  return <a href={url} download={filename || true} className={`${style} border-emerald-300/60 bg-emerald-700 text-white hover:bg-emerald-600`}>Download</a>;
}
