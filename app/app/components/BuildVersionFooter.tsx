"use client";

import React, { useEffect, useState } from "react";
import { BUILD_VERSION, BUILD_HISTORY, type BuildIdentity } from "@/lib/buildHistory";

export default function BuildVersionFooter() {
  const [identity, setIdentity] = useState<BuildIdentity | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/app/build", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const result = await response.json() as BuildIdentity;
        if (!controller.signal.aborted && result.buildVersion === BUILD_VERSION) setIdentity(result);
      }).catch(() => { /* The build label remains readable if details are unavailable. */ });
    return () => controller.abort();
  }, []);
  return <footer aria-label="Application build" className="min-w-0 rounded-[22px] border p-4 text-sm" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}>
    <p className="font-semibold">SLR Studios · Build {BUILD_VERSION}</p>
    <details className="mt-2" style={{ color: "var(--color-text-muted)" }}>
      <summary className="min-h-11 cursor-pointer py-2">Build history &amp; release details</summary>
      {identity?.commit ? <p className="mt-2 break-all font-mono text-xs">Revision: {identity.commit}</p> : null}
      {identity?.releaseName ? <p className="mt-2 break-all text-xs">Release: {identity.releaseName}</p> : null}
      {identity?.builtAt ? <p className="mt-2 text-xs">Built: {identity.builtAt}</p> : null}
      <ol className="mt-3 space-y-3">
        {BUILD_HISTORY.slice().reverse().map(build => <li key={build.version}><p>Build {build.version} · {build.date}</p><p className="mt-1 break-words text-xs">{build.summary}</p></li>)}
      </ol>
    </details>
  </footer>;
}
