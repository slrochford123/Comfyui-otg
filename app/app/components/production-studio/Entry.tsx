"use client";
import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
const Studio = dynamic(() => import("./Studio"), {
  loading: () => <p>Opening your production…</p>,
});

/** The production release contains only this entry, not the TEST studio. */
export default function ProductionStudioEntry({
  legacy,
  ownerKey,
}: {
  ownerKey?: string | null;
  legacy: ReactNode;
}) {
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/production-studio/availability", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        setLegacyAvailable(v?.legacyAvailable === true);
        setEnabled(v?.enabled === true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <section
      className="rounded-2xl border border-white/10 bg-black/20 p-5 space-y-4"
      aria-label="Production v.2"
    >
      <h2 className="text-2xl font-semibold">Production v.2</h2>
      {enabled && ownerKey ? (
        <Studio ownerKey={ownerKey} />
      ) : (
        <>
          <p>
            In development. The new studio is not available on this release yet.
          </p>
          <p className="text-sm text-white/60">
            Your previous productions and background jobs are preserved.
          </p>
        </>
      )}
      {legacyAvailable && (
        <button
          className="rounded-xl border border-white/20 p-3"
          onClick={() => setShowLegacy((v) => !v)}
        >
          {showLegacy
            ? "Close legacy recovery"
            : "Administrator: open legacy productions"}
        </button>
      )}
      {legacyAvailable && showLegacy ? legacy : null}
    </section>
  );
}
