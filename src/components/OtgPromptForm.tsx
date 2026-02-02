"use client";

import { useState } from "react";
import { getOrCreateOtgDeviceId, otgFetch } from "../lib/otgDevice";

export default function OtgPromptForm({ onDone }: { onDone?: () => void }) {
  const [jsonText, setJsonText] = useState<string>("{}");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      const deviceId = getOrCreateOtgDeviceId();
      const prompt = JSON.parse(jsonText || "{}");

      const r = await otgFetch("/api/otg/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId, prompt }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `generate ${r.status}`);

      onDone?.();
    } catch (e: any) {
      setErr(e?.message ?? "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full space-y-2">
      <div className="text-sm opacity-80">
        Paste a ComfyUI API prompt JSON (the body you would POST to /prompt).
      </div>
      <textarea
        className="w-full min-h-[160px] rounded-lg border p-2 font-mono text-sm"
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
        spellCheck={false}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="px-3 py-2 rounded-lg border"
          onClick={submit}
          disabled={busy}
        >
          {busy ? "Generating..." : "Generate"}
        </button>
        {err ? <div className="text-red-500 text-sm">{err}</div> : null}
      </div>
    </div>
  );
}
