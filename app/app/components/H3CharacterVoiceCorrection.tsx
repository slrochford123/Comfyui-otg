"use client";
import React from "react";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { FixVoicesHandoff } from "./TestingFixVoices";

const ChangeVoicePanel = dynamic(() => import("./TestingFixVoices"));

export default function H3CharacterVoiceCorrection({ source, enabled = false }: { source: FixVoicesHandoff; enabled?: boolean }) {
  const [available, setAvailable] = useState(enabled);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<FixVoicesHandoff>();
  useEffect(() => {
    if (enabled) return;
    const controller = new AbortController();
    void fetch("/api/production/audio/analyze-clip", { cache: "no-store", signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setAvailable(response.ok); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled]);

  if (!available) return null;
  return <div className="mt-2" data-otg="h3-character-voice-correction">
    <button type="button" aria-expanded={open}
      className="min-h-9 rounded-lg border border-white/20 px-3 py-1.5 text-sm"
      onClick={() => {
        if (!open) setSelection(source);
        setOpen(!open);
      }}>{open ? "Close Change Voice" : "Change Voice"}</button>
    {open && selection && <div role="region" aria-label="Change Voice" className="mt-2">
      <ChangeVoicePanel handoff={selection} />
    </div>}
  </div>;
}
